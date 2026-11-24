// @stylistic/brace-style puts braces on their own line for functions, classes, and statements,
// but not for TypeScript `interface`, `enum`, and `namespace` bodies. This rule covers those.

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: { description: "Opening brace of interface/enum/namespace bodies on its own line" },
    messages: { ownLine: "Put the opening brace on its own line." },
  },

  create(context)
  {
    const source = context.sourceCode;

    function check(body)
    {
      const brace = source.getFirstToken(body);
      const before = source.getTokenBefore(brace);

      if (!brace || brace.value !== "{" || !before || before.loc.end.line !== brace.loc.start.line) return;

      const indent = source.lines[before.loc.start.line - 1].match(/^\s*/)[0];

      context.report({
        node: body,
        loc: brace.loc,
        messageId: "ownLine",
        fix: (fixer) => fixer.replaceTextRange([before.range[1], brace.range[0]], `\n${indent}`),
      });
    }

    return { TSInterfaceBody: check, TSEnumBody: check, TSModuleBlock: check };
  },
};
