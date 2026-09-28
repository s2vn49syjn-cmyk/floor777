import {main} from './publish-workflow/cli.mjs';
main('rollback').catch(error => {console.error(error.message); process.exitCode = 1;});
