const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests',testMatch:['local-client.spec.cjs','local-store.spec.cjs'],timeout:30000,workers:1,
  reporter:[['list'],['junit',{outputFile:'../docs/household/local-client-tests.xml'}]],use:{screenshot:'only-on-failure'}});
