// Types for the tests; the Worker itself is plain JavaScript so it can be pasted into the Cloudflare dashboard.
declare const worker: { fetch(request: Request): Promise<Response> };
export default worker;
