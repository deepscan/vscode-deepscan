# VS Code DeepScan

[![DeepScan Grade](https://deepscan.io/api/projects/1808/branches/7873/badge/grade.png)](https://deepscan.io/dashboard/#view=project&pid=1808&bid=7873)

Extension to integrate [DeepScan](https://deepscan.io) into VS Code.

## Development setup
- run `npm install` inside the `deepscan` and `deepscan-server` folders
- open VS Code on `deepscan` and `deepscan-server`

## Developing the server
- open VS Code on `deepscan-server`
- run `npm run compile` to build the server (it is automatically copied into the `deepscan` folder)
- to debug press F5 which attaches a debugger to the server

## Developing the extension/client
- open VS Code on `deepscan`
- run F5 to build and debug the extension
