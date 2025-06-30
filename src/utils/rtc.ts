type FileMeta = {
    fileId: string;
    name: string;
    size: number;
    type: string;
    totalChunks: number;
};

const CHUNK_SIZE = 16 * 1024; // 16KB

export class PeerTransfer {
    peerId: string;
    remoteId: string | null = null;
    ws: WebSocket;
    peerConnection?: RTCPeerConnection;
    dataChannel?: RTCDataChannel;

    onConnect?: () => void;
    onDisconnect?: () => void;
    onFileInfo?: (meta: FileMeta) => void;
    onProgress?: (progress: number) => void;
    onComplete?: (file: Blob, meta: FileMeta) => void;

    private incomingChunks: ArrayBuffer[] = [];
    private expectedChunks = 0;
    private receivingFile?: FileMeta;

    constructor(serverURL: string, peerId: string) {
        this.peerId = peerId;
        this.ws = new WebSocket(serverURL);
        this.ws.onopen = () => console.log('✅ WebSocket connected');
        this.ws.onmessage = this.handleSignal;
    }

    setRemoteId(id: string) {
        this.remoteId = id;
    }

    initPeerConnection(initiator: boolean) {
        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.peerConnection.onicecandidate = (e) => {
            if (e.candidate && this.remoteId) {
                this.sendSignal({ type: 'candidate', candidate: e.candidate });
            }
        };

        if (initiator) {
            this.dataChannel = this.peerConnection.createDataChannel('data');
            this.setupDataChannel();
            this.peerConnection.createOffer().then((offer) => {
                this.peerConnection?.setLocalDescription(offer);
                this.sendSignal({ type: 'offer', sdp: offer.sdp });
            });
        } else {
            this.peerConnection.ondatachannel = (e) => {
                this.dataChannel = e.channel;
                this.setupDataChannel();
            };
        }

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            if (state === 'connected') this.onConnect?.();
            if (state === 'disconnected' || state === 'failed') this.onDisconnect?.();
        };
    }

    private setupDataChannel() {
        if (!this.dataChannel) return;
        this.dataChannel.binaryType = 'arraybuffer';
        this.dataChannel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB

        this.dataChannel.onmessage = (e) => {
            if (typeof e.data === 'string') {
                const msg = JSON.parse(e.data);
                if (msg.messageType === 'file-info') this.handleFileInfo(msg.meta);
                if (msg.messageType === 'file-complete') this.handleComplete();
            } else {
                this.handleFileChunkBinary(e.data);
            }
        };
    }

    private sendSignal(msg: Record<string, unknown>, attempt = 0) {
        const MAX_RETRIES = 20;
        const RETRY_DELAY = 100;

        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ...msg, from: this.peerId, to: this.remoteId }));
            return;
        }

        if (this.ws.readyState === WebSocket.CONNECTING && attempt < MAX_RETRIES) {
            setTimeout(() => this.sendSignal(msg, attempt + 1), RETRY_DELAY);
        } else {
            console.warn('❌ WebSocket not open. Dropping signal:', msg);
        }
    }

    private handleSignal = async (e: MessageEvent) => {
        const msg = JSON.parse(e.data) as {
            type: 'offer' | 'answer' | 'candidate';
            from: string;
            to: string;
            sdp?: string;
            candidate?: RTCIceCandidateInit;
        };

        if (msg.to !== this.peerId) return;

        switch (msg.type) {
            case 'offer':
                this.remoteId = msg.from;
                this.initPeerConnection(false);
                await this.peerConnection?.setRemoteDescription({ type: 'offer', sdp: msg.sdp! });
                const answer = await this.peerConnection?.createAnswer();
                await this.peerConnection?.setLocalDescription(answer!);
                this.sendSignal({ type: 'answer', sdp: answer?.sdp });
                break;

            case 'answer':
                await this.peerConnection?.setRemoteDescription({ type: 'answer', sdp: msg.sdp! });
                break;

            case 'candidate':
                await this.peerConnection?.addIceCandidate(msg.candidate!);
                break;
        }
    };

    sendFile(file: File) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            console.warn('⚠️ Data channel not ready');
            return;
        }

        const fileId = Date.now().toString();
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const meta: FileMeta = {
            fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            totalChunks
        };

        this.dataChannel.send(JSON.stringify({ messageType: 'file-info', meta }));
        this.dataChannel.bufferedAmountLowThreshold = 1024 * 1024;

        let chunkIndex = 0;
        let isReading = false;

        const sendNextChunk = () => {
            if (!this.dataChannel || chunkIndex >= totalChunks || isReading) return;

            if (this.dataChannel.bufferedAmount > 16 * 1024 * 1024) {
                // Wait for drain
                return;
            }

            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            const reader = new FileReader();
            isReading = true;

            reader.onload = () => {
                if (!(reader.result instanceof ArrayBuffer)) return;

                const chunkData = reader.result;
                isReading = false;

                const trySend = () => {
                    if (this.dataChannel!.bufferedAmount > 16 * 1024 * 1024) {
                        setTimeout(trySend, 50); // wait for buffer to drain
                        return;
                    }

                    try {
                        this.dataChannel!.send(chunkData);
                    } catch (err: unknown) {
                        if (err.message?.includes('send queue is full')) {
                            setTimeout(trySend, 50); // try again later
                        } else {
                            console.error('❌ Unexpected send error:', err);
                        }
                        return;
                    }

                    chunkIndex++;
                    this.onProgress?.(Math.floor((chunkIndex / totalChunks) * 100));

                    if (chunkIndex < totalChunks) {
                        sendNextChunk();
                    } else {
                        this.dataChannel?.send(JSON.stringify({ messageType: 'file-complete', fileId }));
                    }
                };

                trySend();
            };


            reader.onerror = () => {
                isReading = false;
                console.error('❌ FileReader error while reading chunk');
            };

            reader.readAsArrayBuffer(chunk);
        };

        this.dataChannel.onbufferedamountlow = () => {
            sendNextChunk();
        };

        sendNextChunk(); // start
    }

    private handleFileInfo(meta: FileMeta) {
        this.receivingFile = meta;
        this.expectedChunks = meta.totalChunks;
        this.incomingChunks = [];
        this.onFileInfo?.(meta);
    }

    private handleFileChunkBinary(data: ArrayBuffer) {
        this.incomingChunks.push(data);
        this.onProgress?.(
            Math.floor((this.incomingChunks.length / this.expectedChunks) * 100)
        );
    }

    private handleComplete() {
        if (!this.receivingFile) return;
        const blob = new Blob(this.incomingChunks, { type: this.receivingFile.type });
        this.onComplete?.(blob, this.receivingFile);
        this.incomingChunks = [];
        this.expectedChunks = 0;
        this.receivingFile = undefined;
    }
}
