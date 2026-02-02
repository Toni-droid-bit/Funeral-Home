import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';

export function setupDeepgramWebSocket(httpServer: Server) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url === '/ws/deepgram') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (clientWs: WebSocket) => {
    console.log('xScribe: Client connected for live transcription');

    let deepgramWs: WebSocket | null = null;
    let fullTranscript = '';

    clientWs.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'start') {
            fullTranscript = '';
            const language = message.language || 'en';

            const params = new URLSearchParams({
              model: 'nova-2',
              language,
              punctuate: 'true',
              diarize: 'true',
              smart_format: 'true',
              encoding: 'linear16',
              sample_rate: '16000',
              channels: '1',
              interim_results: 'true',
              utterance_end_ms: '1000',
              endpointing: '300',
            });

            const dgUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

            deepgramWs = new WebSocket(dgUrl, {
              headers: {
                Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
              },
            });

            deepgramWs.on('open', () => {
              console.log('xScribe: Connected to Deepgram');
              clientWs.send(JSON.stringify({ type: 'ready' }));
            });

            deepgramWs.on('message', (dgData: Buffer) => {
              try {
                const response = JSON.parse(dgData.toString());

                if (response.type === 'Results') {
                  const alt = response.channel?.alternatives?.[0];
                  if (!alt) return;

                  const transcript = alt.transcript || '';
                  const isFinal = response.is_final;
                  const speechFinal = response.speech_final;

                  if (transcript.trim()) {
                    // Append to full transcript when we get a final result
                    // Use speechFinal to add newlines between utterances
                    if (isFinal) {
                      if (speechFinal) {
                        fullTranscript += (fullTranscript ? '\n' : '') + transcript;
                      } else {
                        // For non-speech-final but still final results, append with space
                        fullTranscript += (fullTranscript ? ' ' : '') + transcript;
                      }
                    }

                    clientWs.send(
                      JSON.stringify({
                        type: 'transcript',
                        transcript,
                        isFinal: !!isFinal,
                        speechFinal: !!speechFinal,
                        fullTranscript,
                      })
                    );
                  }
                }

                if (response.type === 'Metadata') {
                  console.log('xScribe: Deepgram session started, request ID:', response.request_id);
                }
              } catch (err) {
                console.error('xScribe: Error parsing Deepgram response:', err);
              }
            });

            deepgramWs.on('error', (err: Error) => {
              console.error('xScribe: Deepgram WebSocket error:', err.message);
              clientWs.send(
                JSON.stringify({
                  type: 'error',
                  message: 'Transcription service error: ' + err.message,
                })
              );
            });

            deepgramWs.on('close', (code: number) => {
              console.log(`xScribe: Deepgram connection closed (code: ${code})`);
            });
          }

          if (message.type === 'stop') {
            if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
              deepgramWs.send(JSON.stringify({ type: 'CloseStream' }));
              setTimeout(() => {
                if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
                  deepgramWs.close();
                }
              }, 1500);
            }

            clientWs.send(JSON.stringify({ type: 'stopped', fullTranscript }));
          }
        } catch (e) {
          // Not valid JSON — ignore
        }
        return;
      }

      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.send(data);
      }
    });

    clientWs.on('close', () => {
      console.log('xScribe: Client disconnected');
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });

    clientWs.on('error', (err: Error) => {
      console.error('xScribe: Client WebSocket error:', err.message);
      if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
        deepgramWs.close();
      }
    });
  });

  console.log('xScribe: Live transcription WebSocket ready on /ws/deepgram');
}
