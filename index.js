const readline = require('readline');
const fs = require('fs');
const path = require("path");
const {promisify} = require('util');
const child_process = require('child_process');


const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const exists = promisify(fs.exists);
const lstat = promisify(fs.lstat);
const unlink = promisify(fs.unlink);

const configFilename = ".deploy-config";
const progressFilename = "deploy-progress.json";

const writeConfig = (obj) => writeFile(configFilename, JSON.stringify(obj, null, "\t"));
const readConfig = async () => JSON.parse(await readFile(configFilename));
const writeToProgress = (obj) => writeFile(progressFilename, JSON.stringify(obj));
const exec = (cmd, opts) => new Promise((resolve, reject) => child_process.exec(cmd, opts, function(err, stdout, stderr) { if (err) { reject(err); } stdout = stdout.toString(); stderr = stdout.toString(); resolve({both:stdout+"\n"+stderr,stdout:stdout,stderr:stderr}); }) );

String.prototype.replaceAll = function(search, replacement) {
	var target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};

const nextProgress = (function() {
	let index = 0;
	const timeInSeconds = [];
	let obj = {
		progress: index,
		limit: 0,
		description: "Started script",
		done: false,
		started: new Date().toISOString()
	}
	const func = async function(description) {
		const rightNow = new Date();
		obj.description = description;
		timeInSeconds.push((rightNow-(new Date(obj.started)))/1000);
		obj.started = rightNow.toISOString();
		obj.progress = index;
		try {
			await writeToProgress(obj);
		} catch (err) {
			console.log("Could not write progress file, check your permissions for the current folder");
			console.error(err);
			process.exit(1);
		}
		index++;
	}
	func.getIndex = function() {
		return index;
	}
	func.setLimit = function(limit) {
		obj.limit = limit;
	}
	return func;
})();

init();

async function getConfigFile() {
	let config;
	try {
		config = await readConfig();
	} catch (err) {
		console.log("Could not open or read config file");
		console.error(err);
		process.exit(1);
	}
	if (config === undefined || typeof config["app-path"] !== "string") {
		console.log("Invalid configuration file contents:");
		console.error(config);
		process.exit(1);
	}
	return config;
}

async function checkFirstTimeRun() {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	const question = (str) => new Promise(resolve => rl.question(str, resolve));
	const yes = await question("Do you want to deploy the application now for the first time (yes/[no])? ");
	if (yes !== "y" && yes !== "yes") {
		console.log("Aborted");
		process.exit();
	}
	rl.close();
}

async function fetchRepository(config) {
	let result;
	try {
		process.env["GIT_SSH_COMMAND"]="echo";
		process.env["GIT_TERMINAL_PROMPT"]="0";
		result = await exec('git config credential.modalprompt false --global && git fetch --all --quiet', {cwd:config["app-path"]});
		if (result === undefined || result.both.length > 4) {
			console.log("Git fetching returned invalid value");
			console.error(result.stdout);
			console.error(result.stderr);
			process.exit(1);
		}
	} catch (err) {
		console.log("Could not fetch repository");
		console.error(err);
		process.exit(1);
	}
}
async function resetRepository(config) {
	let result;
	try {
		await exec('git reset --hard origin/master', {cwd:config["app-path"]}).both;
	} catch (err) {
		console.log("Could not reset the repository");
		console.error(err);
		process.exit(1);
	}
}

async function cleanRepository(config) {
	let result;
	try {
		await exec('git clean -f -d && git clean -f -x -d', {cwd:config["app-path"]}).both;
	} catch (err) {
		console.log("Could not clean the repository");
		console.error(err);
		process.exit(1);
	}
}

async function pullRepository(config) {
	let result;
	try {
		await new Promise(r=>setTimeout(r, 100));
		result = await exec('git pull --quiet', {cwd:config["app-path"]});
	} catch (err) {
		console.log("Could not pull repository from origin");
		console.error(err);
		process.exit(1);
	}
}
		//"git reset --hard origin/master && git clean -f -d && git clean -f -x -d && git clean -fxd && git pull");


async function finishProgress(config) {
	const index = nextProgress.getIndex()+1;
	await unlink(progressFilename);
	console.log("Deploy finished after "+(index).toFixed(0)+" steps");
	if (config["step-count"] !== index || config["auto-run"] === false) {
		if (config["step-count"] !== index) {
			config["step-count"] = index;
		}
		if (config["auto-run"] === false) {
			config["auto-run"] = true;
		}
		try {
			console.log("writing to config");
			await writeConfig(config);
		} catch (err) {
			console.log("Could not save configuration file, check your permissions for the current folder");
			console.error(err);
			process.exit(1);
		}
	}
}
async function assertGoogleCloudUtility(config) {
	let result;
	try {
		result = (await exec('gcloud app versions list --project='+config["app-name"]+" --format=text", {cwd:config["app-path"]})).both;
	} catch (err) {
		if (err.message.trim().indexOf("'gcloud' is not recognized") !== -1) {
			console.log("The gcloud utility was not found or is not installed");
		} else {
			console.log("Could not execute gcloud from command line");
			console.log(err.message);
			process.exit(1);
		}
		process.exit(1);
	}
	if (result.indexOf("ERROR") !== -1) {
		console.log("The gcloud utility returned an error");
		console.log(result);
		process.exit(1);
	}
	if (result.trim().indexOf("environment.name") === -1) {
		console.log("The gcloud utility returned unexpectedly");
		console.log(result);
		process.exit(1);
	}
	return true;
}

async function assertGit() {
	let result;
	try {
		result = (await exec('git --version', {timeout: 10000})).both;
		if (result === undefined) {
			throw new Error("Could not read responde from git client checking")
		}
		if (result.toLowerCase().indexOf("error") !== -1 || result.toLowerCase().indexOf("could not") !== -1 || result.toLowerCase().indexOf("is not") !== -1) {
			console.log("The git client was not found or is not installed");
			console.error("To download it, use this link: https://git-scm.com/downloads");
			process.exit(1);
		}
	} catch (err) {
		console.log("Could not assert the existance of git in this machine");
		if (err.signal === "SIGTERM") {
			console.log("Command took to long to return");
		} else {
			console.error(err);
		}
		process.exit(1);
	}
}

async function deployToGoogleCloud(config) {
	let result;
	try {
		result = await exec('gcloud --quiet app deploy --project='+config["app-name"], {cwd:config["app-path"]});
		if (result.both.length > 3) {
			console.log("Warning: gcloud returned unexpected value:");
			console.error(result);
		}
	} catch (err) {
		console.log("Could not execute google cloud from command line");
		console.error(err);
		process.exit(1);
	}
}

async function deploy() {
	await nextProgress("Loading config file");
	const config = await getConfigFile();

	await nextProgress("Checking first run");
	if (config["auto-run"] === false) {
		await checkFirstTimeRun();
	}

	if (config["step-count"]) {
		if (typeof config["step-count"] !== "string") {
			config["step-count"] = parseInt(config["step-count"]);
		}
		nextProgress.setLimit(config["step-count"]);
	}

	const resolvedPath = path.resolve(__dirname, config["app-path"]);

	await nextProgress("Checking git cli utility");
	await assertGit();

	await nextProgress("Checking gcloud cli utility");
	await assertGoogleCloudUtility(config);

	await nextProgress("Fetching repository information");
	await fetchRepository(config);

	await nextProgress("Reseting repository to head");
	await resetRepository(config);

	await nextProgress("Cleaning repository leftovers");
	await cleanRepository(config);

	await nextProgress("Pulling newest state from origin/master");
	await pullRepository(config);

	await nextProgress("Deploying application to google cloud");
	await deployToGoogleCloud(config);

	await finishProgress(config);
}

async function isRepoUpdated() {
	let result;

	try {
		result = await exec("git status", {timeout: 10000});
		if (result === undefined) {
			throw new Error("Could not read responde from git client")
		}
		result = result.stdout;
		if (result.toLowerCase().indexOf("error") !== -1 || result.toLowerCase().indexOf("could not") !== -1 || result.toLowerCase().indexOf("is not") !== -1) {
			console.log("The git client was not found or is not installed");
			console.error("To download it, use this link: https://git-scm.com/downloads");
			process.exit(1);
		}
		if (result.toLowerCase().indexOf("branch is up to date") !== -1) {
			return true;
		}
	} catch (err) {
		console.log("Something went wrong while trying to retrieve data about the repository");
		if (err.signal === "SIGTERM") {
			console.log("The command 'git status' took too long to return");
		} else {
			console.error(err);
		}
		process.exit(1);
	}
	return false;
}

async function configure() {
	console.log("Starting configuration for deploy");

	const rl = readline.createInterface({
	    input: process.stdin,
	    output: process.stdout
	});

	const question = (str) => new Promise(resolve => rl.question(str, resolve));
	const defaultQuestion = (str, def) => (question(`${str} [${def}]: `) || def);

	const config = {};

	config["app-name"] = await defaultQuestion("Project name", "anonymous");
	if (config["app-name"] === undefined) {
		console.log("Could not read your answer correcly");
		process.exit(1);
	}

	while (1) {
		config["app-path"] = await defaultQuestion("Application path", "..");
		// invalidate empty directory
		if (config["app-path"] === undefined) {
			console.log("Could not read your answer correcly, please try again");
			continue;
		}
		if (config["app-path"].length == 0) {
			console.log("Directory must not be empty! Use dot (.) for current directory.");
			continue;
		}
		// replace inverted slashes
		config["app-path"] = config["app-path"].replace("\\", "/");
		// assert it ends in a slash
		if (config["app-path"].substr(-1) !== "/") {
			config["app-path"] = config["app-path"]+"/";
		}
		// assert it is a directory
		try {
			const isDirectory = (await lstat(config["app-path"])).isDirectory();
			if (!isDirectory) {
				console.log("Not a valid directory!");
				continue;
			}
		} catch (err) {
			console.log("Could not validate directory "+config['app-path']);
			console.error(err);
			continue;
		}
		// assert it has a git file
		try {
			const hasGit = (await lstat(config["app-path"]+".git")).isDirectory();
			if (!hasGit) {
				console.log("This directory is missing a git repository, you must initialize it first");
				continue;
			}
		} catch (err) {
			console.log("Could not validate if directory "+config['app-path']+" is a git repository");
			console.error(err);
			continue;
		}
		break;
	}
	config["auto-run"] = true;
	try {
		await writeConfig(config);
	} catch (err) {
		console.log("Could not save configuration file, check your permissions for the current folder");
		console.error(err);
		rl.close();
		process.exit(1);
	}

	const resolvedPath = path.resolve(__dirname, config["app-path"]);

	let repo;
	try {
		repo = await nodegit.Repository.open(resolvedPath);
	} catch (err) {
		console.log("Could not open repository in the specified path:");
		console.log(resolvedPath);
		console.error(err);
		process.exit(1);
	}
	isRepoUpdated = await isRepoUpdated(config);
	if (!isRepoUpdated) {
		console.log(" * There are unsaved files in the repository!");
		console.log(" * The repo will be forcefully updated, removing any unsaved code!");
	}
	console.log("The very first deploy will be executed now");
	const yes = await question("Are you sure you wish to continue (yes/[no])? ");
	if (yes !== "y" && yes !== "yes") {
		config["auto-run"] = false;
		try {
			await writeConfig(config);
		} catch (err) {
			console.log("Could not save configuration file again");
			console.error(err);
			process.exit(1);
		}
		console.log("Aborted by user");
		process.exit();
	}
	rl.close();
	try {
		await deploy();
	} catch (err) {
		console.log("Could not execute first deploy");
		console.error(err);
		config["auto-run"] = false;
		try {
			await writeConfig(config);
		} catch (err) {
			console.log("Could not save configuration file again");
			console.error(err);
			process.exit(1);
		}
	}
}

async function init() {
	var hasConfigFile = false;
	try {
		hasConfigFile = (await lstat(configFilename)).isFile();
	} catch (err) {
		console.log("Could not determine if the config file exists");
		console.error(err);
		process.exit(1);
	}

	const forceConfig = (process.argv[2] === "--configure");
	if (hasConfigFile && !forceConfig) {
		try {
			return await deploy();
		} catch (err) {
			console.log("Could not deploy due to error");
			console.error(err);
			process.exit(1);
		}
	} else {
		try {
			return await configure();
		} catch (err) {
			console.log("Could not configure due to error");
			console.error(err);
			process.exit(1);
		}
	}
}