/**
 * Shared ESLint rules for apps/dashboard and apps/website specifically — not
 * packages/ui, which has to render the very elements react/forbid-elements forbids here in
 * order to build the components these rules send app code to. Kept out of ./eslint (the
 * repo-wide base every workspace, packages/ui included, extends) for exactly that reason.
 *
 * Both apps spread the default export AFTER eslint-config-next's core-web-vitals/typescript
 * configs: the jsx-a11y rules below are listed by name against a plugin core-web-vitals
 * registers first (see the comment on that block) — importing eslint-plugin-jsx-a11y here
 * and spreading its own flatConfigs.recommended would throw "Cannot redefine plugin
 * jsx-a11y" instead.
 *
 * `tokensOnlyRules` is also exported by itself: the tokens-only-colour and RTL-safety
 * no-restricted-syntax rules apply just as much to packages/ui's own component source as
 * to app code — nothing about "no hardcoded palette colour" or "no physical-direction
 * utility" is specific to being an app — so packages/ui's own eslint.config.mjs spreads
 * this alone, without react/forbid-elements or the jsx-a11y additions (it already runs the
 * plugin's full recommended set directly, not through core-web-vitals' partial one).
 */
export const tokensOnlyRules = {
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        // Every standard Tailwind palette family, PLUS an arbitrary bracket-value colour
        // on the same set of colour-bearing utilities (bg-[#ff0000], text-[rgb(0,0,0)]) —
        // the first alternative alone mirrors button.test.tsx's regex but would miss the
        // second form entirely (verified: it does not match bg-[#ff0000]), which is just
        // as much a literal colour as bg-red-500. The bracket alternative only matches
        // when the bracket's own content starts with a colour syntax (#, rgb(/rgba(/
        // hsl(/hsla() — outline-[2px]/ring-[2px] (arbitrary WIDTH, not colour) don't
        // start with any of those and stay unmatched.
        selector:
          "Literal[value=/\\b(?:bg|text|border|divide|ring|outline|accent|caret|decoration|shadow|from|via|to|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\\d{2,3})?\\b|\\b(?:bg|text|border|divide|ring|outline|accent|caret|decoration|shadow|from|via|to|fill|stroke)-\\[(?:#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/]",
        message:
          "Use a --sh-* design token (bg-primary, text-foreground, border-border, ...) instead of a literal Tailwind palette colour — see theme.css. A genuine non-className match (a string literal, a test assertion) can disable this one line with a comment explaining why, rather than weakening the pattern.",
      },
      {
        // Same pattern as above, against a TemplateElement instead of a Literal: a
        // template-literal className (`h-3 w-full ${className ?? ""}`, already an
        // established pattern in this codebase) puts its text in value.raw, not
        // value — invisible to the Literal selector above.
        selector:
          "TemplateElement[value.raw=/\\b(?:bg|text|border|divide|ring|outline|accent|caret|decoration|shadow|from|via|to|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\\d{2,3})?\\b|\\b(?:bg|text|border|divide|ring|outline|accent|caret|decoration|shadow|from|via|to|fill|stroke)-\\[(?:#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/]",
        message:
          "Use a --sh-* design token (bg-primary, text-foreground, border-border, ...) instead of a literal Tailwind palette colour — see theme.css. A genuine non-className match (a string literal, a test assertion) can disable this one line with a comment explaining why, rather than weakening the pattern.",
      },
      {
        // The same physical-direction utilities verified clean in this repo's own RTL
        // audit. The first alternative catches the abbreviated-prefix forms (ml-4,
        // rounded-l-lg); the second is a standalone \bleft\b/\bright\b word-boundary
        // match, needed because "left"/"right" often has NO trailing hyphen at all —
        // text-left, float-left, origin-left — so the old single pattern (which required
        // one) missed every bare-suffix form entirely (verified: it did not match
        // text-right). Two lookbehinds exclude the standalone match's two real false
        // positives found running this against packages/ui: `data-[side=left]` is Radix's
        // OWN attribute-selector vocabulary describing which side of the trigger a popover
        // actually rendered on (not something the author chose, and there is no logical
        // equivalent to switch it to); `slide-in-from-left`/`slide-out-to-right` is
        // tw-animate-css's own physical-only utility naming, which this codebase already
        // handles correctly by gating each one behind an ltr:/rtl: variant (sheet.tsx) — a
        // different vocabulary the ms-/me-/start-/end- suggestion in this rule's own
        // message does not even apply to. Urdu is a real, shipped locale on the dashboard,
        // and a public school site is exactly the kind of page a parent may view in ur.
        selector:
          "Literal[value=/\\b(?:ml|mr|pl|pr|rounded-l|rounded-r|border-l|border-r)-|(?<!=)(?<!-from-)(?<!-to-)\\b(?:left|right)\\b/]",
        message:
          "Use logical properties (ms-/me-/ps-/pe-/start-/end-/rounded-s-/rounded-e-/border-s-/border-e-) instead of physical left/right utilities — must stay RTL-safe for the ur locale. A genuine non-className match can disable this one line with a comment explaining why, rather than weakening the pattern.",
      },
      {
        // Same TemplateElement gap as the palette rule above.
        selector:
          "TemplateElement[value.raw=/\\b(?:ml|mr|pl|pr|rounded-l|rounded-r|border-l|border-r)-|(?<!=)(?<!-from-)(?<!-to-)\\b(?:left|right)\\b/]",
        message:
          "Use logical properties (ms-/me-/ps-/pe-/start-/end-/rounded-s-/rounded-e-/border-s-/border-e-) instead of physical left/right utilities — must stay RTL-safe for the ur locale. A genuine non-className match can disable this one line with a comment explaining why, rather than weakening the pattern.",
      },
    ],
  },
};

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
    },
  },
  tokensOnlyRules,
];
