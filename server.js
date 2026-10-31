
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const sessions = new Map();

function createDiagramPlan(input) {
  const {
    cutStyle = "",
    permStyle = "",
    elevation = "",
    technicalNotes = "" 
  } = input;

  const known = technicalNotes.trim();

  return {
    title: "헤어더뷰 AI 헤어 도해도 설계안",
    input: { cutStyle, permStyle, elevation, technicalNotes },
    status: "교육용 제안 설계안",
    expert: {
      cut: [
        `커트 스타일: ${cutStyle}`,
        `엘리베이션: ${elevation}° (입력값, 적용 구간 확인 필요)`,
         : "엘리베이션: 미입력 — 적용 각도 확인 필요",
        "섹션: 정면·측면·후면·탑뷰로 구분해 설계",
        "가이드라인: 디자이너가 기준 길이와 이동 방향 확정",
        "오버다이렉션: 얼굴 주변과 후면 연결 구간별 확인"
      ],
      perm: [
        `펌 스타일: ${permStyle}`,
        "롯드 크기: 미입력 — 실제 모발 길이와 목표 컬에 맞게 결정",
        "와인딩 방향: 미입력 — 디자인 방향에 따라 결정",
        "섹션 배열: 미입력 — 디자이너 확인 필요"
      ]
    },
    beginner: [
      "1단계: 완성하고 싶은 실루엣과 기준 길이를 확인합니다.",
      "2단계: 커트 섹션과 가이드라인을 설정합니다.",
      "3단계: 입력한 엘리베이션의 적용 구간을 확인합니다.",
      "4단계: 펌 섹션, 롯드 크기와 와인딩 방향을 정합니다.",
      "5단계: 커트와 펌 설계가 목표 스타일에 맞는지 검토합니다."
    ],
    notes: known || "추가 기술 정보 없음",
    warning:
      "사진만으로 실제 커트 구조와 펌 와인딩을 확정할 수 없습니다. 이 문서는 교육용 설계 초안입니다."
  };
}

function createMcpServer() {
  const server = new McpServer({
    name: "hairthebeau-diagram",
    version: "1.0.0"
  });

  server.tool(
    "create_hair_diagram_plan",
    "헤어더뷰 커트 및 펌 전문가용·교육용 도해도 설계안을 생성합니다.",
    {
      cutStyle: z.string().default(""),
      permStyle: z.string().default(""),
      elevation: z.string().default(""),
      technicalNotes: z.string().default("")
    },
    async (input) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(createDiagramPlan(input), null, 2)
        }
      ]
    })
  );

  return server;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, mcp-session-id, mcp-protocol-version, authorization, last-event-id",
  "access-control-expose-headers": "mcp-session-id"
};

function json(res, status, value) {
  res.writeHead(status, {
    ...cors,
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      throw new Error("요청 데이터가 너무 큽니다.");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const app = createServer(async (req, res) => {
  for (const [key, value] of Object.entries(cors)) {
    res.setHeader(key, value);
  }

  const path = new URL(req.url || "/", "http://localhost").pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (path === "/" || path === "/health") {
    json(res, 200, {
      ok: true,
      name: "헤어더뷰 AI 도해도 제작기",
      mcp: "/mcp"
    });
    return;
  }

  if (path !== "/mcp") {
    json(res, 404, { error: "Not found" });
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  let entry =
    typeof sessionId === "string"
      ? sessions.get(sessionId)
      : undefined;

  try {
    let body;

    if (req.method === "POST") {
      body = await readBody(req);
    }

    if (!entry) {
      if (
        req.method !== "POST" ||
        sessionId ||
        body?.method !== "initialize" ||
        body?.jsonrpc !== "2.0"
      ) {
        json(res, 400, {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "POST /mcp로 세션을 먼저 초기화하세요."
          },
          id: null
        });
        return;
      }

      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
        }
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      await server.connect(transport);
      entry = { server, transport };
    }

    await entry.transport.handleRequest(req, res, body);
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      json(res, 500, {
        error: "Server error",
        message: String(error.message || error)
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`헤어더뷰 도해도 MCP 서버 실행: ${PORT}`);
});
