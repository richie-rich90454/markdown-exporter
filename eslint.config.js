import js from "@eslint/js";
import globals from "globals";
import solid from "eslint-plugin-solid";
import tseslint from "typescript-eslint";

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

const noEmojiPlugin = {
    rules: {
        "no-emoji": {
            meta: {
                type: "problem",
                docs: { description: "Forbid emoji anywhere in this project." },
                schema: [],
                messages: { found: "Emoji is not allowed: {{found}}" }
            },
            create(context) {
                return {
                    Program() {
                        const text = context.sourceCode.getText();
                        const match = EMOJI.exec(text);
                        if (match !== null) {
                            const index = context.sourceCode.getLocFromIndex(match.index).line;
                            context.report({
                                loc: { line: index, column: 1 },
                                messageId: "found",
                                data: { found: match[0] }
                            });
                        }
                    }
                };
            }
        }
    }
};

export default tseslint.config(
    { ignores: ["dist/", "playwright-report/", "test-results/", "node_modules/"] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    solid.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.browser }
        },
        rules: {
            "no-emoji/no-emoji": "error",
            "@typescript-eslint/consistent-type-imports": "error",
            "no-console": "error",
            eqeqeq: "error",
            "prefer-const": "error",
            // Stores and controllers are plain objects built once at the
            // composition root, so the props-derived heuristic only produces
            // noise for this codebase's shape.
            "solid/reactivity": "off"
        },
        plugins: { "no-emoji": noEmojiPlugin }
    },
    {
        languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
        },
        files: ["src/**/*.{ts,tsx}", "tests/**/*.ts", "e2e/**/*.ts", "*.ts", "*.js"]
    },
    {
        // The lint config is plain JavaScript and not part of the app project,
        // so it is parsed without type information.
        files: ["eslint.config.js", "public/**/*.js", "scripts/**/*.mjs"],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: { globals: { ...globals.node } }
    },
    {
        files: ["tests/**/*.ts", "playwright/**/*.ts"],
        rules: { "no-console": "off" }
    },
    {
        files: ["src/domain/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "**/adapter/**",
                                "**/port/**",
                                "**/application/**",
                                "**/state/**",
                                "**/ui/**"
                            ],
                            message: "domain/ must not import other layers."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: ["src/port/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "**/adapter/**",
                                "**/application/**",
                                "**/state/**",
                                "**/ui/**"
                            ],
                            message: "port/ must not import other layers."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: ["src/state/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/adapter/**", "**/ui/**"],
                            message: "state/ must not import adapters or ui/."
                        },
                        { group: ["**/port/**"], message: "state/ must not import ports." }
                    ]
                }
            ]
        }
    },
    {
        files: ["src/application/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/adapter/**", "**/state/**", "**/ui/**"],
                            message: "application/ must not import adapters, state/ or ui/."
                        }
                    ]
                }
            ]
        }
    },
    {
        files: ["src/ui/**/*.{ts,tsx}", "src/index.tsx"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        { group: ["**/adapter/**"], message: "ui/ must not import adapters." }
                    ]
                }
            ]
        }
    }
);
