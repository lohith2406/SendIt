// src/utils/rtc.ts

type FileMeta = {
    fileId: string
    name: string
    size: number
    type: string
    totalChunks: number
}

const CHUNK_SIZE = 16 * 1024 // 16KB

export class PeerTransfer {
    peerId: string
    remoteId: string | null = null
    ws: WebSocket
    peerConnection?: RTCPeerConnection
    dataChannel?: RTCDataChannel

    onConnect?: () => void
    onDisconnect?: () => void
    onFileInfo?: (meta: FileMeta) => void
    onProgress?: (progress: number) => void
    onComplete?: (file: Blob, meta: FileMeta) => void

    private incomingChunks: ArrayBuffer[] = []
    private expectedChunks = 0
    private receivingFile?: FileMeta

    constructor(serverURL: string, peerId: string) {
        this.peerId = peerId
        this.ws = new WebSocket(serverURL)

        this.ws.onopen = () => {
            console.log('✅ WebSocket connected')
        }

        this.ws.onmessage = this.handleSignal
    }

    setRemoteId(id: string) {
        this.remoteId = id
    }

    initPeerConnection(initiator: boolean) {
        console.log('🧩 Initializing peer connection. Initiator:', initiator)
        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        })

        this.peerConnection.onicecandidate = (e) => {
            if (e.candidate && this.remoteId) {
                console.log('🧊 Sending ICE candidate')
                this.sendSignal({ type: 'candidate', candidate: e.candidate })
            }
        }

        if (initiator) {
            this.dataChannel = this.peerConnection.createDataChannel('data')
            this.setupDataChannel()
            this.peerConnection
                .createOffer()
                .then((offer) => {
                    this.peerConnection?.setLocalDescription(offer)
                    console.log('📨 Sending SDP offer')
                    this.sendSignal({ type: 'offer', sdp: offer.sdp })
                })
        } else {
            this.peerConnection.ondatachannel = (e) => {
                this.dataChannel = e.channel
                this.setupDataChannel()
            }
        }

        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState
            console.log('🔁 Connection state changed:', state)
            if (state === 'connected') this.onConnect?.()
            if (state === 'disconnected' || state === 'failed') this.onDisconnect?.()
        }
    }

    private setupDataChannel() {
        if (!this.dataChannel) return
        this.dataChannel.onmessage = (e) => {
            const msg = JSON.parse(e.data)
            if (msg.messageType === 'file-info') this.handleFileInfo(msg.meta)
            if (msg.messageType === 'file-chunk') this.handleFileChunk(msg)
            if (msg.messageType === 'file-complete') this.handleComplete(msg)
        }
    }

    private sendSignal(msg: Record<string, any>, attempt = 0) {
        const MAX_RETRIES = 20
        const RETRY_DELAY = 100

        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ...msg, from: this.peerId, to: this.remoteId }))
            return
        }

        if (this.ws.readyState === WebSocket.CONNECTING && attempt < MAX_RETRIES) {
            console.warn('🔁 Retrying sendSignal in 100ms (attempt ' + attempt + ')');
            setTimeout(() => this.sendSignal(msg, attempt + 1), RETRY_DELAY)
        } else {
            console.warn('❌ WebSocket not open. Dropping signal:', msg)
        }
    }


    private handleSignal = async (e: MessageEvent) => {
        const msg = JSON.parse(e.data)
        if (msg.to !== this.peerId) return

        switch (msg.type) {
            case 'offer':
                console.log('📥 Received SDP offer')
                this.remoteId = msg.from
                this.initPeerConnection(false)
                await this.peerConnection?.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
                const answer = await this.peerConnection?.createAnswer()
                await this.peerConnection?.setLocalDescription(answer!)
                this.sendSignal({ type: 'answer', sdp: answer?.sdp })
                break

            case 'answer':
                console.log('📥 Received SDP answer')
                await this.peerConnection?.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
                break

            case 'candidate':
                console.log('📥 Received ICE candidate')
                await this.peerConnection?.addIceCandidate(msg.candidate)
                break
        }
    }

    sendFile(file: File) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            console.warn('⚠️ Data channel not ready')
            return
        }

        const fileId = Date.now().toString()
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
        const meta: FileMeta = {
            fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            totalChunks,
        }

        this.dataChannel.send(JSON.stringify({ messageType: 'file-info', meta }))

        let chunk = 0
        const sendNext = () => {
            const start = chunk * CHUNK_SIZE
            const end = Math.min(start + CHUNK_SIZE, file.size)
            const reader = new FileReader()
            reader.onload = () => {
                const base64 = btoa(String.fromCharCode(...new Uint8Array(reader.result as ArrayBuffer)))
                this.dataChannel?.send(JSON.stringify({
                    messageType: 'file-chunk',
                    fileId,
                    chunkNumber: chunk,
                    data: base64,
                }))
                chunk++
                this.onProgress?.(Math.floor((chunk / totalChunks) * 100))
                if (chunk < totalChunks) sendNext()
                else this.dataChannel?.send(JSON.stringify({ messageType: 'file-complete', fileId }))
            }
            reader.readAsArrayBuffer(file.slice(start, end))
        }

        sendNext()
    }

    private handleFileInfo(msg: FileMeta) { 
        this.receivingFile = msg
        this.expectedChunks = msg.totalChunks
        this.incomingChunks = []
        this.onFileInfo?.(msg)
    }

    private handleFileChunk(msg: { data: string; fileId: string; chunkNumber: number }) {
        const binaryString = atob(msg.data)
        const buffer = new ArrayBuffer(binaryString.length)
        const view = new Uint8Array(buffer)
        for (let i = 0; i < binaryString.length; i++) {
            view[i] = binaryString.charCodeAt(i)
        }
        this.incomingChunks[msg.chunkNumber] = buffer
        this.onProgress?.(
            Math.floor((this.incomingChunks.length / this.expectedChunks) * 100)
        )
    }

    private handleComplete(msg: { fileId: string }) {
        if (!this.receivingFile) return
        const blob = new Blob(this.incomingChunks, { type: this.receivingFile.type })
        this.onComplete?.(blob, this.receivingFile)
        this.incomingChunks = []
        this.expectedChunks = 0
        this.receivingFile = undefined
    }
}
