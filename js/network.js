/* Dark Fantasy Chess — WebRTC P2P Multiplayer (PeerJS or public STUN).
 * Allows sharing a simple game link (e.g. #join=room-xyz) so friends can play without a backend server!
 */
(function() {
  'use strict';

  class PeerMultiplayer {
    constructor(onRemoteMove, onStatusChange) {
      this.peer = null;
      this.conn = null;
      this.roomId = null;
      this.isHost = false;
      this.onRemoteMove = onRemoteMove;
      this.onStatusChange = onStatusChange;
    }

    init() {
      return new Promise((resolve, reject) => {
        if (typeof Peer === 'undefined') {
          console.warn('PeerJS not loaded');
          resolve(false);
          return;
        }

        const id = 'dfc-' + Math.random().toString(36).substring(2, 9);
        this.peer = new Peer(id, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });

        this.peer.on('open', (id) => {
          this.roomId = id;
          this.onStatusChange('ready', id);
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          this.conn = conn;
          this.isHost = true;
          this._setupConn();
          this.onStatusChange('connected', { isHost: true });
        });

        this.peer.on('error', (err) => {
          console.error('Peer error:', err);
          this.onStatusChange('error', err.type || err);
        });
      });
    }

    connectTo(remoteId) {
      if (!this.peer) return;
      this.onStatusChange('connecting', remoteId);
      this.conn = this.peer.connect(remoteId, { reliable: true });
      this.isHost = false;
      this._setupConn();
    }

    _setupConn() {
      this.conn.on('open', () => {
        this.onStatusChange('connected', { isHost: this.isHost });
      });

      this.conn.on('data', (data) => {
        if (data && data.type === 'move') {
          this.onRemoteMove(data.move);
        } else if (data && data.type === 'chat') {
          this.onStatusChange('chat', data.text);
        } else if (data && data.type === 'sync') {
          this.onStatusChange('sync', data);
        }
      });

      this.conn.on('close', () => {
        this.onStatusChange('disconnected');
      });
    }

    sendMove(move) {
      if (this.conn && this.conn.open) {
        this.conn.send({ type: 'move', move });
      }
    }

    sendSync(state) {
      if (this.conn && this.conn.open) {
        this.conn.send({ type: 'sync', ...state });
      }
    }
  }

  window.PeerMultiplayer = PeerMultiplayer;
})();
