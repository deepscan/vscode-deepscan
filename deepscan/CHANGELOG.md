# Change Log

## 1.4.3

- Update rule definition (1.8.0-beta)
- Update README for the proxy

## 1.4.2

- Proxy support
 - Try to use `deepscan.proxy` option
 - Then try to use 'http_proxy' environment variable

## 1.4.1

- Clear previous problems when there is no source to inspect

## 1.4.0

- New code actions
 - **Ignore this line**: Insert `// deepscan-disable-line` at the line
 - **Ignore this rule**: Insert `// deepscan-disable-line <rule>` at the line
- Improved code actions
 - **Show rule**: Show all the rules at the line
- Not to analyze a file over 30,000 lines

## 1.3.4

- Update rule definition (1.7.0-beta)
- Support to disable rules with inline comments. Check it [here](https://deepscan.io/docs/get-started/disabling-rules/).
- Code complete for directives to disable rules: `deepscan-disable`, `deepscan-enable`, `deepscan-disable-line`, `deepscan-enable-line`
- Show rule name explicitly (replacing 'Show more')

## 1.3.3

- Handle error message nicely (to prevent server crash)

## 1.3.2

- Update badge url

## 1.3.1

- Update rule definition (1.6.0-beta)
- Fix DeepScan alarms and add a badge
- Note: DeepScan now supports TypeScript 2.5

## 1.3.0

- TypeScript support: Support code inspection for `*.ts` and `*.tsx` files on save
- Update rule definition (1.5.0-beta)

## 1.2.4

- Show a status bar message for disconnected server

## 1.2.3

- Show rule name in the alarm
- Provide `deepscan.ignoreRules` option to exclude specific rules

## 1.2.2

- Update rule definition (1.4.0-beta)

## 1.2.1

- Inspect open text documents when `deepscan.server` configuration is changed
- Show rule description only for a DeepScan diagnostic
- Change the source of diagnostic to "deepscan"

## 1.2.0

- Show rule description when the user clicks the light bulb of the problem

## 1.1.2

- Provide keywords for the extension

## 1.1.1

- Need to confirm that your code is transferred to the DeepScan server when you re-start VS Code after the installation
- Support code inspection for `*.js`, `*.jsx` files on save
- Two options are provided: `deepscan.enable`, `deepscan.server`
