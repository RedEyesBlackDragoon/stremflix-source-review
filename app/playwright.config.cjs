const {defineConfig}=require('@playwright/test');
const path=require('node:path');
const python=path.resolve(__dirname,process.platform==='win32'?'../household/.venv/Scripts/python.exe':'../household/.venv/bin/python');
module.exports=defineConfig({testDir:'./tests',timeout:30000,workers:1,reporter:[['list'],['junit',{outputFile:'../docs/household/client-tests.xml'}]],
  use:{baseURL:'http://127.0.0.1:8876',screenshot:'only-on-failure'},
  webServer:{command:`"${python}" ../household/tests/ui_server.py`,url:'http://127.0.0.1:8876/v1/health',reuseExistingServer:false,timeout:15000}});
