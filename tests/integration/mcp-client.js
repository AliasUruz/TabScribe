const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function runTest() {
  console.log("=== INICIANDO TESTE MCP CLIENT ===");
  
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, "../../server/tabscribe-mcp.js")]
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("✅ Conectado ao servidor MCP (tabscribe-mcp.js) via Stdio.");

  console.log("⏳ Aguardando 2 segundos para dar tempo do Chrome conectar no WebSocket na porta 3031...");
  await new Promise(r => setTimeout(r, 2000));

  try {
    console.log("\n🛠️ Listando Ferramentas Disponíveis:");
    const tools = await client.listTools();
    tools.tools.forEach(t => console.log(` - ${t.name}: ${t.description}`));

    console.log("\n📡 Aguardando a extensão Chrome conectar (polling 'tabscribe_status')...");
    let isConnected = false;
    for (let i = 0; i < 150; i++) {
        const statusResult = await client.callTool({ name: "tabscribe_status", arguments: {} });
        const text = statusResult.content[0].text;
        if (JSON.parse(text).connected === true) {
            isConnected = true;
            console.log("\n🔗 Extensão conectada com sucesso!");
            break;
        }
        process.stdout.write(".");
        await new Promise(r => setTimeout(r, 2000));
    }

    if (!isConnected) {
        console.log("\n❌ Timeout aguardando a extensão. Recarregue a extensão no Chrome e tente novamente.");
        process.exit(1);
    }

    console.log("\n🔎 Executando pesquisa de notícias via MCP...");
    const searchResult = await client.callTool({
      name: "tabscribe_auto_search",
      arguments: {
        queries: [
          "Últimas notícias Brasil hoje política economia",
          "Guerra na Ucrânia e Gaza atualizações hoje",
          "Principais notícias tecnologia e IA março 2026"
        ],
        config: {
          engine: "google",
          maxLinksPerQuery: 3,
          useIntelligentExtraction: true,
          useAiOverviewOnly: false,
          useDnsBypass: false
        }
      }
    });
    console.log("\nResultado do Auto-Search via MCP:\n");
    console.log(searchResult.content[0].text);

  } catch (error) {
    console.error("❌ Erro durante a execução do teste:", error.message);
  } finally {
    console.log("\n=== TESTE FINALIZADO ===");
    process.exit(0);
  }
}

runTest();
