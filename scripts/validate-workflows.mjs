import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowFiles = [
  "main-workflow.json",
  "error-handler.json",
  "analytics-workflow.json",
];

const errors = [];
const workflows = new Map();

function fail(file, message) {
  errors.push(`[${file}] ${message}`);
}

for (const file of workflowFiles) {
  const fullPath = path.join(root, file);

  if (!fs.existsSync(fullPath)) {
    fail(file, "файл не найден");
    continue;
  }

  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    fail(file, `некорректный JSON: ${error.message}`);
    continue;
  }

  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    fail(file, "корневое значение должно быть JSON-объектом");
    continue;
  }

  if (typeof workflow.name !== "string" || !workflow.name.trim()) {
    fail(file, "не задано имя workflow");
  }

  if (!Array.isArray(workflow.nodes)) {
    fail(file, "поле nodes должно быть массивом");
    continue;
  }

  if (!workflow.connections || typeof workflow.connections !== "object") {
    fail(file, "поле connections должно быть объектом");
    continue;
  }

  const nodeNames = new Set();
  const nodeIds = new Set();

  for (const node of workflow.nodes) {
    if (!node || typeof node !== "object") {
      fail(file, "обнаружен некорректный элемент в nodes");
      continue;
    }

    if (typeof node.name !== "string" || !node.name.trim()) {
      fail(file, "у узла отсутствует name");
    } else if (nodeNames.has(node.name)) {
      fail(file, `повторяется имя узла: "${node.name}"`);
    } else {
      nodeNames.add(node.name);
    }

    if (typeof node.id !== "string" || !node.id.trim()) {
      fail(file, `у узла "${node.name ?? "без имени"}" отсутствует id`);
    } else if (nodeIds.has(node.id)) {
      fail(file, `повторяется ID узла: "${node.id}"`);
    } else {
      nodeIds.add(node.id);
    }

    if (typeof node.type !== "string" || !node.type.trim()) {
      fail(file, `у узла "${node.name ?? "без имени"}" отсутствует type`);
    }
  }

  for (const [sourceName, outputs] of Object.entries(workflow.connections)) {
    if (!nodeNames.has(sourceName)) {
      fail(file, `connection ссылается на отсутствующий исходный узел "${sourceName}"`);
    }

    if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
      fail(file, `connections для узла "${sourceName}" имеют неверную структуру`);
      continue;
    }

    for (const [connectionType, branches] of Object.entries(outputs)) {
      if (!Array.isArray(branches)) {
        fail(file, `выход "${connectionType}" узла "${sourceName}" должен быть массивом`);
        continue;
      }

      for (const branch of branches) {
        if (!Array.isArray(branch)) {
          fail(file, `ветка "${connectionType}" узла "${sourceName}" должна быть массивом`);
          continue;
        }

        for (const target of branch) {
          if (!target || typeof target.node !== "string") {
            fail(file, `найдена некорректная связь из "${sourceName}"`);
          } else if (!nodeNames.has(target.node)) {
            fail(file, `узел "${sourceName}" ссылается на отсутствующий узел "${target.node}"`);
          }
        }
      }
    }
  }

  workflows.set(file, workflow);
  console.log(`✓ ${file}: JSON прочитан, узлов — ${workflow.nodes.length}`);
}

const main = workflows.get("main-workflow.json");
const errorHandler = workflows.get("error-handler.json");

if (main && errorHandler) {
  const expectedErrorWorkflowId = errorHandler.id;

  if (!expectedErrorWorkflowId) {
    fail("error-handler.json", "не задан ID workflow для связи с основным процессом");
  } else if (main.settings?.errorWorkflow !== expectedErrorWorkflowId) {
    fail(
      "main-workflow.json",
      "settings.errorWorkflow не совпадает с ID error-handler.json"
    );
  }
}

const requiredNodes = {
  "main-workflow.json": [
    "Telegram Trigger",
    "Basic LLM Chain",
    "Google Gemini Chat Model",
    "Structured Output Parser",
    "Insert row",
    "If",
  ],
  "error-handler.json": ["Error Trigger", "Send a text message"],
  "analytics-workflow.json": [
    "When clicking ‘Execute workflow’",
    "Edit Fields",
    "Get row(s)",
    "Code in JavaScript",
    "Send a text message",
  ],
};

for (const [file, names] of Object.entries(requiredNodes)) {
  const workflow = workflows.get(file);
  if (!workflow) continue;

  const actualNames = new Set(workflow.nodes.map((node) => node.name));
  for (const name of names) {
    if (!actualNames.has(name)) {
      fail(file, `не найден обязательный узел "${name}"`);
    }
  }
}

if (errors.length > 0) {
  console.error("\nПроверка workflow завершилась с ошибками:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("\nВсе workflow прошли структурную проверку.");
}
