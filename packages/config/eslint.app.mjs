/**
 * Shared ESLint rules for apps/dashboard and apps/website specifically — not
 * packages/ui, which has to render the very elements react/forbid-elements forbids here in
 * order to build the components these rules send app code to. Kept out of ./eslint (the
 * repo-wide base every workspace, packages/ui included, extends) for exactly that reason.
 *
 * Both apps spread this AFTER eslint-config-next's core-web-vitals/typescript configs: the
 * jsx-a11y rules below are listed by name against a plugin core-web-vitals registers first
 * (see the comment on that block) — importing eslint-plugin-jsx-a11y here and spreading its
 * own flatConfigs.recommended would throw "Cannot redefine plugin jsx-a11y" instead.
 */
export default [
  {
    rules: {
      // eslint-config-next's core-web-vitals already registers the jsx-a11y plugin, but
      // activates only 6 of its rules (alt-text/aria-props/aria-proptypes/
      // aria-unsupported-elements/role-has-required-aria-props/role-supports-aria-props).
      // packages/ui runs the full 34-rule recommended set; this raises both apps to the
      // same bar.
      "jsx-a11y/anchor-ambiguous-text": "off",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/aria-activedescendant-has-tabindex": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/autocomplete-valid": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/control-has-associated-label": "off",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/html-has-lang": "error",
      "jsx-a11y/iframe-has-title": "error",
      "jsx-a11y/img-redundant-alt": "error",
      "jsx-a11y/interactive-supports-focus": [
        "error",
        {
          tabbable: ["button", "checkbox", "link", "searchbox", "spinbutton", "switch", "textbox"],
        },
      ],
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/label-has-for": "off",
      "jsx-a11y/media-has-caption": "error",
      "jsx-a11y/mouse-events-have-key-events": "error",
      "jsx-a11y/no-access-key": "error",
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/no-distracting-elements": "error",
      "jsx-a11y/no-interactive-element-to-noninteractive-role": [
        "error",
        { tr: ["none", "presentation"], canvas: ["img"] },
      ],
      "jsx-a11y/no-noninteractive-element-interactions": [
        "error",
        {
          handlers: [
            "onClick",
            "onError",
            "onLoad",
            "onMouseDown",
            "onMouseUp",
            "onKeyPress",
            "onKeyDown",
            "onKeyUp",
          ],
          alert: ["onKeyUp", "onKeyDown", "onKeyPress"],
          body: ["onError", "onLoad"],
          dialog: ["onKeyUp", "onKeyDown", "onKeyPress"],
          iframe: ["onError", "onLoad"],
          img: ["onError", "onLoad"],
        },
      ],
      "jsx-a11y/no-noninteractive-element-to-interactive-role": [
        "error",
        {
          ul: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
          ol: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
          li: ["menuitem", "menuitemradio", "menuitemcheckbox", "option", "row", "tab", "treeitem"],
          table: ["grid"],
          td: ["gridcell"],
          fieldset: ["radiogroup", "presentation"],
        },
      ],
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { tags: [], roles: ["tabpanel"], allowExpressionValues: true },
      ],
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/no-static-element-interactions": [
        "error",
        {
          allowExpressionValues: true,
          handlers: ["onClick", "onMouseDown", "onMouseUp", "onKeyPress", "onKeyDown", "onKeyUp"],
        },
      ],
      "jsx-a11y/scope": "error",
      "jsx-a11y/tabindex-no-positive": "error",

      // "Custom components are not allowed" — @schoolhub/ui wraps every one of these
      // with the token-driven styling, focus rings and (for Form) aria wiring these apps
      // depend on.
      "react/forbid-elements": [
        "error",
        {
          forbid: [
            { element: "button", message: "use <Button> from @schoolhub/ui instead" },
            { element: "input", message: "use <Input> from @schoolhub/ui instead" },
            { element: "select", message: "use <Select> from @schoolhub/ui instead" },
            { element: "textarea", message: "use <Textarea> from @schoolhub/ui instead" },
            { element: "label", message: "use <Label> from @schoolhub/ui instead" },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          // Every standard Tailwind palette family — mirrors the regex
          // packages/ui/src/components/button.test.tsx already enforces at the
          // component level, extended here to every className in this app. This is
          // what would have caught the 9 border-black/1x violations apps/website
          // actually shipped, fixed by hand in an earlier PR in this stack.
          selector:
            "Literal[value=/\\b(?:bg|text|border|divide|ring|outline|accent|caret|decoration|shadow|from|via|to|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\\d{2,3})?\\b/]",
          message:
            "Use a --sh-* design token (bg-primary, text-foreground, border-border, ...) instead of a literal Tailwind palette colour — see theme.css. A genuine non-className match (a string literal, a test assertion) can disable this one line with a comment explaining why, rather than weakening the pattern.",
        },
        {
          // Same pattern as above, against a TemplateElement instead of a Literal: a
          // template-literal className (`h-3 w-full ${className ?? ""}`, already an
          // established pattern in this codebase) puts its text in value.raw, not
          // value — invisible to the Literal selector above.
          selector:
            "TemplateElement[value.raw=/\\b(?:bg|text|border|divide|ring|outline|accent|caret|decoration|shadow|from|via|to|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\\d{2,3})?\\b/]",
          message:
            "Use a --sh-* design token (bg-primary, text-foreground, border-border, ...) instead of a literal Tailwind palette colour — see theme.css. A genuine non-className match (a string literal, a test assertion) can disable this one line with a comment explaining why, rather than weakening the pattern.",
        },
        {
          // The same physical-direction utilities verified clean in this repo's own
          // RTL audit. Urdu is a real, shipped locale on the dashboard, and a public
          // school site is exactly the kind of page a parent may view in ur — this is
          // what keeps both apps clean going forward instead of relying on someone
          // remembering to grep for it before every release.
          selector:
            "Literal[value=/\\b(?:ml|mr|pl|pr|rounded-l|rounded-r|border-l|border-r|left|right)-/]",
          message:
            "Use logical properties (ms-/me-/ps-/pe-/start-/end-/rounded-s-/rounded-e-/border-s-/border-e-) instead of physical left/right utilities — this app must stay RTL-safe for the ur locale. A genuine non-className match can disable this one line with a comment explaining why, rather than weakening the pattern.",
        },
        {
          // Same TemplateElement gap as the palette rule above.
          selector:
            "TemplateElement[value.raw=/\\b(?:ml|mr|pl|pr|rounded-l|rounded-r|border-l|border-r|left|right)-/]",
          message:
            "Use logical properties (ms-/me-/ps-/pe-/start-/end-/rounded-s-/rounded-e-/border-s-/border-e-) instead of physical left/right utilities — this app must stay RTL-safe for the ur locale. A genuine non-className match can disable this one line with a comment explaining why, rather than weakening the pattern.",
        },
      ],
    },
  },
];
