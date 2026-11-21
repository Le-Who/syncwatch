import path from "node:path";
import Input from "postcss/lib/input";
import tokenize from "postcss/lib/tokenize";
import ts from "typescript";
import { Parser as YamlParser } from "yaml";

const generatedFiles = new Set(["next-env.d.ts", "pnpm-lock.yaml"]);
const ignoreFiles = new Set([
  ".dockerignore",
  ".gitignore",
  ".prettierignore",
  ".slugignore",
]);

function scriptRanges(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false);
  scanner.setText(text);
  const ranges = [];
  const initializers = new Map();
  const embedded = [];
  let previousEnd = 0;

  function visit(node) {
    if (ts.isJSDoc(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      initializers.set(node.name.text, node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const { name, expression } = node.expression;
      const receiver = expression.getText(source);
      const argument = node.arguments[0];
      if (
        argument &&
        name.text === "eval" &&
        /\bredis(?:client)?\b/i.test(receiver)
      ) {
        embedded.push([argument, luaRanges]);
      }
      if (
        argument &&
        file === "__tests__/persistence-migrations.test.ts" &&
        receiver === "db" &&
        ["exec", "query"].includes(name.text)
      ) {
        embedded.push([argument, sqlRanges]);
      }
    }

    const children = node.getChildren(source);
    if (children.length > 0) {
      children.forEach(visit);
    } else if (node.kind !== ts.SyntaxKind.SyntaxList) {
      const start = ts.isJsxText(node) ? node.pos : node.getStart(source);
      scanner.setTextPos(previousEnd);
      while (scanner.getTextPos() < start) {
        const kind = scanner.scan();
        if (
          kind === ts.SyntaxKind.SingleLineCommentTrivia ||
          kind === ts.SyntaxKind.MultiLineCommentTrivia
        ) {
          ranges.push([scanner.getTokenStart(), scanner.getTextPos()]);
        }
      }
      previousEnd = node.end;
    }
  }
  visit(source);

  const scripts = new Map();
  for (const [argument, scan] of embedded) {
    const script = ts.isIdentifier(argument)
      ? initializers.get(argument.text)
      : argument;
    if (script) scripts.set(script, scan);
  }
  const worker = initializers.get("workerCode");
  if (file === "app/api/youtube/search/route.ts" && worker) {
    scripts.set(worker, (body) => scriptRanges("worker.mjs", body));
  }
  for (const [script, scan] of scripts) {
    ranges.push(...embeddedRanges(source, script, scan));
  }
  return ranges;
}

function embeddedRanges(source, script, scan) {
  const start = script.getStart(source) + 1;
  let body = source.text.slice(start, script.end - 1);
  if (ts.isTemplateExpression(script)) {
    const chunks = [];
    let offset = 0;
    let interpolation = script.head.end - start - 2;
    for (const { literal } of script.templateSpans) {
      const end = literal.getStart(source) - start + 1;
      chunks.push(
        body.slice(offset, interpolation),
        body.slice(interpolation, end).replace(/[^\n]/g, " "),
      );
      offset = end;
      interpolation = literal.end - start - 2;
    }
    body = chunks.join("") + body.slice(offset);
  } else if (
    !ts.isNoSubstitutionTemplateLiteral(script) &&
    !ts.isStringLiteral(script)
  ) {
    return [];
  }
  return scan(body).map(([from, to]) => [start + from, start + to]);
}

function jsonRanges(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false);
  scanner.setText(text);
  const ranges = [];
  for (
    let kind = scanner.scan();
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = scanner.scan()
  ) {
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      ranges.push([scanner.getTokenStart(), scanner.getTextPos()]);
    }
  }
  return ranges;
}

function cssRanges(text) {
  const tokens = tokenize(new Input(text));
  const ranges = [];
  while (!tokens.endOfFile()) {
    const [kind, , start, end] = tokens.nextToken();
    if (kind === "comment") ranges.push([start, end + 1]);
  }
  return ranges;
}

function yamlRanges(text) {
  const ranges = [];
  function visit(value) {
    if (value?.type === "comment") {
      ranges.push([value.offset, value.offset + value.source.length]);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  }
  for (const token of new YamlParser().parse(text)) visit(token);
  return ranges;
}

function lineEnd(text, start) {
  const newline = text.indexOf("\n", start);
  return newline === -1 ? text.length : newline;
}

function quotedEnd(text, start, quote, backslash, doubled = false) {
  let position = start + 1;
  while (position < text.length) {
    const char = text[position++];
    if (backslash && char === "\\") {
      position++;
    } else if (char === quote) {
      if (!doubled || text[position] !== quote) return position;
      position++;
    }
  }
  return text.length;
}

function literalEnd(text, start, delimiter) {
  const position = text.indexOf(delimiter, start);
  return position === -1 ? text.length : position + delimiter.length;
}

function luaRanges(text) {
  const ranges = [];
  const tokens = /--(?:\[(=*)\[)?|\[(=*)\[|["']|[^\[\-'"\n]+|./gsy;
  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const [token, commentEquals, stringEquals] = match;
    const start = match.index;
    if (commentEquals !== undefined || stringEquals !== undefined) {
      const equals = commentEquals ?? stringEquals;
      tokens.lastIndex = literalEnd(text, tokens.lastIndex, `]${equals}]`);
    } else if (token === "--") {
      tokens.lastIndex = lineEnd(text, start);
    } else if (token === '"' || token === "'") {
      tokens.lastIndex = quotedEnd(text, start, token, true);
    }
    if (token.startsWith("--")) ranges.push([start, tokens.lastIndex]);
  }
  return ranges;
}

function sqlRanges(text) {
  const ranges = [];
  const tokens =
    /--[^\n]*|\/\*|\$(?:[a-z_]\w*)?\$|e?'|"|[a-z_][\w$]*|;|\s+|./gisy;
  let words = [];
  let bodies = [];

  function finishStatement() {
    const isDoBlock = words[0] === "DO";
    const isRoutine = /^CREATE (OR REPLACE )?(FUNCTION|PROCEDURE)\b/.test(
      words.join(" "),
    );
    const languageIndex = words.lastIndexOf("LANGUAGE");
    const language =
      languageIndex === -1 ? undefined : words[languageIndex + 1];
    if (
      (isDoBlock || isRoutine) &&
      (!language || language === "PLPGSQL" || language === "SQL")
    ) {
      for (const [start, end, quoted] of bodies) {
        const body = text.slice(start, end);
        const doubledQuotes = [];
        const decoded = quoted
          ? body.replace(/''/g, (_, offset) => {
              doubledQuotes.push(offset - doubledQuotes.length);
              return "'";
            })
          : body;
        const toRaw = (offset) =>
          start +
          offset +
          doubledQuotes.filter((quote) => quote < offset).length;
        for (const [from, to] of sqlRanges(decoded))
          ranges.push([toRaw(from), toRaw(to)]);
      }
    }
    words = [];
    bodies = [];
  }

  for (let match = tokens.exec(text); match; match = tokens.exec(text)) {
    const [token] = match;
    const start = match.index;
    if (token.startsWith("--")) {
      ranges.push([start, tokens.lastIndex]);
    } else if (token === "/*") {
      const blocks = /\/\*|\*\//g;
      blocks.lastIndex = tokens.lastIndex;
      let depth = 1;
      for (
        let block = blocks.exec(text);
        block && depth > 0;
        block = blocks.exec(text)
      ) {
        depth += block[0] === "/*" ? 1 : -1;
        if (depth === 0) tokens.lastIndex = blocks.lastIndex;
      }
      if (depth > 0) tokens.lastIndex = text.length;
      ranges.push([start, tokens.lastIndex]);
    } else if (token.endsWith("'") || token === '"') {
      tokens.lastIndex = quotedEnd(
        text,
        tokens.lastIndex - 1,
        token.at(-1),
        token.length > 1,
        true,
      );
      if (token === "'" && (words[0] === "DO" || words.at(-1) === "AS")) {
        bodies.push([start + 1, tokens.lastIndex - 1, true]);
      }
    } else if (token.startsWith("$") && token.length > 1) {
      const bodyStart = tokens.lastIndex;
      tokens.lastIndex = literalEnd(text, bodyStart, token);
      if (words[0] === "DO" || words.at(-1) === "AS") {
        bodies.push([bodyStart, tokens.lastIndex - token.length]);
      }
    } else if (token === ";") {
      finishStatement();
    } else if (/^[a-z_]/i.test(token)) {
      words.push(token.toUpperCase());
    }
  }
  finishStatement();
  return ranges;
}

function hashRanges(text, file) {
  const ranges = [];
  for (let start = 0; start < text.length; ) {
    const end = lineEnd(text, start);
    const line = text.slice(start, end);
    if (ignoreFiles.has(file)) {
      if (line.startsWith("#")) ranges.push([start, end]);
      start = end + 1;
      continue;
    }

    const assignment = /^\s*(?:export\s+)?[^#;=]+?\s*=\s*/.exec(line);
    const valueStart = start + (assignment?.[0].length ?? 0);
    const quote = text[valueStart];
    const commentStart =
      assignment && ['"', "'", "`"].includes(quote)
        ? quotedEnd(text, valueStart, quote, false)
        : valueStart;
    const commentEnd = lineEnd(text, commentStart);
    const offset = text
      .slice(commentStart, commentEnd)
      .search(file === ".npmrc" ? /[#;]/ : /#/);
    if (offset !== -1) ranges.push([commentStart + offset, commentEnd]);
    start = commentEnd + 1;
  }
  return ranges;
}

const scanners = new Map([
  [".css", cssRanges],
  [".json", jsonRanges],
  [".jsonc", jsonRanges],
  [".lua", luaRanges],
  [".sql", sqlRanges],
  [".yaml", yamlRanges],
  [".yml", yamlRanges],
]);

export function commentScanner(file) {
  if (generatedFiles.has(file)) return;
  const extension = path.extname(file);
  const name = path.basename(file);
  if (/^\.(?:[cm]?[jt]s|[jt]sx)$/.test(extension)) {
    return (text) => scriptRanges(file, text);
  }
  if (
    ignoreFiles.has(name) ||
    name === ".npmrc" ||
    /^\.env(?:\.|$)/.test(name)
  ) {
    return (text) => hashRanges(text, name);
  }
  return scanners.get(name === ".prettierrc" ? ".json" : extension);
}

export function scanComments(scan, source) {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  return scan(text)
    .sort(([left], [right]) => left - right)
    .map(([start, end]) => {
      const lines = text.slice(0, start).split("\n");
      return {
        text: text.slice(start, end),
        line: lines.length,
        column: lines.at(-1).length + 1,
      };
    });
}
