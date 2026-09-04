import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "healthy", service: "vcp-platform-e2e-fixture" }));
    return;
  }
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Vibe Coding Platform release fixture\n");
});

server.listen(port, "0.0.0.0");
