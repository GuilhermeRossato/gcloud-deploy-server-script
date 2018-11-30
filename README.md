# Deploy pipeline controller for Google Cloud

This is a node script to deploy to an application and control it's deploy pipeline, along with showing the progress and other usefull things.

The main idea is that this can easily be incorporated in a web application that sends a request for this script to run and monitor it to tell the user how the deploy progress is coming along.

## Motivation

My applications usually need a long deployment pipeline and it is usually very specific, for example:

1. Fetch project from github and all its sub-modules
2. Run composer install to install php dependencies
3. Use babel to transpile javascript code
4. Compress all .js and .css files
5. Check if there are any syntax errors in my scripts
6. Run the necessary tests to check if everything is ok

I need to keep every program that does this in my machine, otherwise, I SHOULD NOT deploy, however:

1. Editing code and submiting to github is very easy and can be done by anyone.
2. I have co-workers who might (and does) deploy untested syntax errors in PHP
3. If my computer stops working, I CANNOT DEPLOY ALTOGETHER.
4. If my hard-drive breaks, I have to setup everything from scratch.

Now, if I have a deployment pipeline inside a docker image or any container, I can quickly run and test my applications!

Better yet: If I make a web app to deploy, all I have to do is click a "deploy" button on it and my application will update with the code I push.

Anyways, github deployment, azure deployment, everything has it's drawbacks. I understand computers and I want full control of what to run and why, I'm a developer after all!

## Who should use this

This script is handy when you have a git repository, a google app engine project and need to control the deploy pipeline of your script.

## How it works

1. Opens app folder
2. Fetch and force pull repo to the most recent commit on `master` branch
3. [Pipeline Control here] Do any extra modification you need (like compress css, html, js) or syntax validation
4. Send a deploy request using the `gcloud` command line interface
5. Done!

## Deploy Progress

Deploy progress can be monitored by reading the `deploy-progress.json` file, which is updated at every deploy step to show how when that step started, how many steps there are total.

Anyone with read permission to that file can query the progress of the deployment, here's a sample of what the file would contain during one of the steps of the deployment:

`{"progress":7,"total":11,"description":"Converting typescript to ES5 with babel","done":false,"started":"2018-11-30T20:30:08.525Z"}`

## Requirements

This script uses `git` and `gcloud` utilities, both should be installed and available on path for this script to run.

## Features

 - Configurates itself on first-run
 - Reconfiguration with `--configure` as parameter
 - Tries to handle any edge cases when deploying
 - Simple script, easily adjustable


Frequently I need to deploy my application from a computer that will not always have
