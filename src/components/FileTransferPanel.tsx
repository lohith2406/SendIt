'use client';

import { useEffect, useRef, useState } from 'react';
import { PeerTransfer } from '@/utils/rtc';

const WS_SERVER = 'wss://sendit-opvc.onrender.com';

export default function FileTransferPanel() {
  const [peerId, setPeerId] = useState('');
  const [remotePeerId, setRemotePeerId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [received, setReceived] = useState<{ url: string; name: string } | null>(null);
  const [connected, setConnected] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const peerRef = useRef<PeerTransfer | null>(null);

  useEffect(() => {
    const id = Math.random().toString(36).slice(2, 10);
    setPeerId(id);

    const peer = new PeerTransfer(WS_SERVER, id);
    peerRef.current = peer;

    peer.onConnect = () => setConnected(true);
    peer.onDisconnect = () => setConnected(false);
    peer.onProgress = (p) => setProgress(p);
    peer.onComplete = (blob, meta) => {
      const url = URL.createObjectURL(blob);
      setReceived({ url, name: meta.name });
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleConnect = () => {
    if (!remotePeerId.trim()) return;
    const peer = peerRef.current;
    if (!peer) return;

    peer.setRemoteId(remotePeerId.trim());
    peer.initPeerConnection(true);
  };

  const handleSend = () => {
    if (file && peerRef.current?.dataChannel?.readyState === 'open') {
      peerRef.current.sendFile(file);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(peerId);
  };

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto bg-white rounded shadow-lg">
        <header className="flex justify-between items-center p-4 bg-blue-600 text-white rounded-t">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <i className="fas fa-share-alt" /> SendIt – P2P File Sharing
          </h1>
          <div
            id="connectionStatus"
            className={`px-3 py-1 rounded-full text-sm flex items-center gap-2
              ${connected ? 'bg-green-500' : 'bg-red-500'}
            `}
          >
            <i className="fas fa-plug" />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
          {/* 📡 Connection Panel */}
          <div className="bg-white shadow rounded p-4 col-span-1 border">
            <h2 className="text-blue-600 font-semibold mb-4 flex items-center gap-2">
              <i className="fas fa-link" /> Connection
            </h2>
            <div className="flex flex-col gap-4">
              <button
                onClick={handleConnect}
                disabled={connected}
                className={`bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded
                  ${connected ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <i className="fas fa-plug" /> {connected ? 'Connected' : 'Connect to Peer'}
              </button>

              <div>
                <label className="font-semibold block mb-1">Your ID:</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={peerId || 'Loading...'}
                    readOnly
                    className="w-full border px-3 py-2 rounded font-mono"
                  />
                  <button
                    onClick={handleCopy}
                    className="text-blue-600 hover:text-blue-800"
                    title="Copy ID"
                  >
                    <i className="far fa-copy" />
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Remote Peer ID:</label>
                <input
                  type="text"
                  value={remotePeerId}
                  onChange={(e) => setRemotePeerId(e.target.value)}
                  placeholder="Enter peer ID"
                  className="w-full border px-3 py-2 rounded"
                />
              </div>
            </div>
          </div>

          {/* 📤 File Upload Panel */}
          <div className="bg-white shadow rounded p-4 col-span-2 border">
            <h2 className="text-blue-600 font-semibold mb-4 flex items-center gap-2">
              <i className="fas fa-exchange-alt" /> File Transfer
            </h2>

            <label
              htmlFor="fileInput"
              className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded p-8 text-center cursor-pointer hover:border-blue-600 transition"
            >
              <i className="fas fa-cloud-upload-alt text-3xl text-blue-600 mb-2" />
              <span className="text-gray-700">
                {file ? `Selected: ${file.name}` : 'Choose a file or drag it here'}
              </span>
              <input
                ref={fileInputRef}
                id="fileInput"
                type="file"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            <button
              onClick={handleSend}
              disabled={!file || !connected}
              className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fas fa-paper-plane" /> Send File
            </button>

            {/* 🔄 Progress Bar */}
            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Progress
              </label>
              <div className="flex items-center gap-4">
                <progress className="w-full" max={100} value={progress}></progress>
                <span className="text-sm text-gray-700">{progress}%</span>
              </div>
            </div>

            {/* ✅ File Received */}
            {received && (
              <div className="mt-6 bg-gray-100 p-4 rounded shadow">
                <h3 className="text-green-600 font-semibold mb-2 flex items-center gap-2">
                  <i className="fas fa-check-circle" /> File Received
                </h3>
                <div className="flex justify-between items-center">
                  <span>{received.name}</span>
                  <a
                    href={received.url}
                    download={received.name}
                    className="text-blue-600 hover:underline"
                  >
                    Download
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
