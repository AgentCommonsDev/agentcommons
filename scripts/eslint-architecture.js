const adapters = /\/apps\/api\/src\/(routes|mcp)\//;
const harnessAdapters =
  /\/(normalizers|readers|install)\/|\/harnesses\.[cm]?[jt]s$|\/fixtures\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const databaseImport =
  /^(pg|@prisma\/client|@agentcommons\/db)(\/|$)|\/(repositories|data)\//;
const propertyName = (node) =>
  node.computed
    ? node.property.type === "Literal"
      ? node.property.value
      : null
    : node.property.name;

export const architecture = {
  rules: {
    "public-copy-attributes": {
      meta: {
        type: "problem",
        schema: [],
        messages: { copy: "Keep user-facing attribute text in copy.ts." },
      },
      create(context) {
        return {
          JSXAttribute(node) {
            if (
              ["alt", "title", "placeholder", "aria-label", "label"].includes(
                node.name.name,
              ) &&
              node.value?.type === "Literal" &&
              typeof node.value.value === "string" &&
              node.value.value.trim()
            ) {
              context.report({ node, messageId: "copy" });
            }
          },
        };
      },
    },
    "services-only": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          data: "Adapters call services. Move database and audit operations into a service.",
        },
      },
      create(context) {
        if (!adapters.test(context.filename)) return {};
        return {
          ImportDeclaration(node) {
            if (databaseImport.test(node.source.value)) {
              context.report({ node, messageId: "data" });
            }
          },
          MemberExpression(node) {
            if (
              [
                "$queryRaw",
                "$executeRaw",
                "$queryRawUnsafe",
                "$executeRawUnsafe",
                "$transaction",
                "auditEvent",
              ].includes(propertyName(node))
            ) {
              context.report({ node, messageId: "data" });
            }
          },
          ImportExpression(node) {
            if (
              node.source.type === "Literal" &&
              databaseImport.test(node.source.value)
            )
              context.report({ node, messageId: "data" });
          },
        };
      },
    },
    "harness-data": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          branch:
            "Put harness differences in the HARNESSES table, a normalizer, reader, or installer.",
        },
      },
      create(context) {
        if (harnessAdapters.test(context.filename)) return {};
        function isHarness(node) {
          return node.type === "Identifier"
            ? node.name === "harness"
            : node.type === "MemberExpression" &&
                propertyName(node) === "harness";
        }
        // Presence checks (null/undefined) are not harness-specific behavior.
        const isAbsence = (node) =>
          (node.type === "Literal" && node.value === null) ||
          (node.type === "Identifier" && node.name === "undefined");
        return {
          BinaryExpression(node) {
            if (
              ["===", "!==", "==", "!="].includes(node.operator) &&
              (isHarness(node.left) || isHarness(node.right)) &&
              !isAbsence(node.left) &&
              !isAbsence(node.right)
            ) {
              context.report({ node, messageId: "branch" });
            }
          },
          SwitchStatement(node) {
            if (isHarness(node.discriminant))
              context.report({ node, messageId: "branch" });
          },
        };
      },
    },
  },
};
