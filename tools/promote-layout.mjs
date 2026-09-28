import {main} from './publish-workflow/cli.mjs';
main('promote').catch(error => {console.error(error.message); process.exitCode = 1;});
