import {main} from './publish-workflow/cli.mjs';
main('publish').catch(error => {console.error(error.message); process.exitCode = 1;});
