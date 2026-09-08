const streams = new Set<EventSource>();
export function registerStream(stream: EventSource): () => void {
  streams.add(stream);
  return () => {
    stream.close();
    streams.delete(stream);
  };
}
export function closeStreams(): void {
  for (const stream of streams) stream.close();
  streams.clear();
}
