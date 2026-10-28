// Types for the tests; the Worker itself is plain JavaScript so it can be pasted into the Cloudflare dashboard.
export interface WorkerEnv {
  CHARTAI_SYNC?: { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> };
  SYNC_KEY?: string;
}
declare const worker: { fetch(request: Request, env?: WorkerEnv): Promise<Response> };
export default worker;
