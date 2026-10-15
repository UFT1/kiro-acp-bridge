import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class AcpClient {
  constructor(command, args, { cwd, onNotification = () => {}, onRequest = async () => {
    throw new Error('Unsupported ACP client request');
  }, timeout = 180_000 } = {}) {
    this.pending = new Map();
    this.nextId = 0;
    this.timeout = timeout;
    this.closed = false;
    this.child = spawn(command, args, {
      cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: { ...process.env, KIRO_LOG_LEVEL: 'error' },
    });
    this.child.stderr.resume();
    this.child.stdin.on('error', error => this.fail(error));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch {
        this.fail(new Error('Invalid JSON on ACP stdout'));
        return;
      }
      if (message.method) {
        if (message.id !== undefined) {
          Promise.resolve().then(() => onRequest(message.method, message.params)).then(
            result => this.send({ id: message.id, result }),
            () => this.send({ id: message.id, error: { code: -32601, message: 'Client operation denied or unsupported' } }),
          );
        } else {
          try { onNotification(message.method, message.params); } catch (error) { this.fail(error); }
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(`ACP request failed (${message.error.code}): ${message.error.message}`));
      } else pending.resolve(message.result);
    });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', (code, signal) => {
      this.fail(new Error(`ACP process exited (${signal ?? code})`));
    });
  }

  send(message) {
    if (this.closed || this.child.stdin.destroyed) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error('ACP connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP timeout: ${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method, params) { this.send({ method, params }); }

  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('ACP connection closed'));
    }
    this.pending.clear();
    try {
      if (process.platform === 'win32') this.child.kill('SIGTERM');
      else process.kill(-this.child.pid, 'SIGTERM');
    } catch {}
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') this.child.kill('SIGKILL');
        else process.kill(-this.child.pid, 'SIGKILL');
      } catch {}
    }, 1_000);
    timer.unref();
  }
}
