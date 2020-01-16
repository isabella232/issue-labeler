import * as core from '@actions/core';
import * as github from '@actions/github';
import * as yaml from 'js-yaml';

async function run() {
  try {
    // Configuration parameters
    const token = core.getInput('repo-token', { required: true });
    const configPath = core.getInput('configuration-path', { required: true });
    const notBefore = Date.parse(core.getInput('not-before', { required: false }));

    const issue_number = getIssueNumber();
    const issue_body = getIssueBody();

    if (!issue_number || !issue_body) {
      console.log('Could not get issue number or issue body from context, exiting');
      return;
    }

    // A client to load data from GitHub
    const client = new github.GitHub(token);

    // If the notBefore parameter has been set to a valid timestamp, exit if the current issue was created before notBefore
    if (notBefore)
    {
      const issue = client.issues.get({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issue_number,
      });
      const issueCreatedAt = Date.parse((await issue).data.created_at)

      if (issueCreatedAt < notBefore) {
        process.exit(1);
      }
    }
    // Load the existing labels the issue has
    const labels = getLabels(client, issue_number)

    // Load our regex rules from the configuration path
    const labelRegexes: Map<string, string[]> = await getLabelRegexes(
      client,
      configPath
    );

    const addLabel: string[] = []
    const removeLabelItems: string[] = []

    for (const [label, globs] of labelRegexes.entries()) {
      if (checkRegexes(issue_body, globs)) {
        addLabel.push(label)
      }
      else
      {
        removeLabelItems.push(label)
      }
    }
    if(addLabel.length > 0)
    {
      console.log(`Adding labels ${ addLabel.toString() } to issue #${ issue_number }`)
      addLabels(client, issue_number, addLabel)
    }

    removeLabelItems.forEach(function (label, index) {
      console.log(`Removing label ${label } from issue #${ issue_number }`)
      removeLabel(client, issue_number, label)
    });
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
}

function getIssueNumber(): number | undefined {
  const issue = github.context.payload.issue;
  if (!issue) {
    return;
  }

  return issue.number;
}

function getIssueBody(): string | undefined {
  const issue = github.context.payload.issue;
  if (!issue) {
    return;
  }

  return issue.body;
}

async function getLabelRegexes(
  client: github.GitHub,
  configurationPath: string
): Promise<Map<string, string[]>> {
  const configurationContent: string = await fetchContent(
    client,
    configurationPath
  );

  // loads (hopefully) a `{[label:string]: string | string[]}`, but is `any`:
  const configObject: any = yaml.safeLoad(configurationContent);

  // transform `any` => `Map<string,string[]>` or throw if yaml is malformed:
  return getLabelRegexesMapFromObject(configObject);
}

// Load the configuration file
async function fetchContent(
  client: github.GitHub,
  repoPath: string
): Promise<string> {
  const response = await client.repos.getContents({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    path: repoPath,
    ref: github.context.sha
  });

  const data: any = response.data
  if (!data.content) {
    console.log('The configuration path provided is not a valid file. Exiting')
    process.exit(1);
  }
  return Buffer.from(data.content, 'base64').toString('utf8');
}

function getLabelRegexesMapFromObject(configObject: any): Map<string, string[]> {
  const labelRegexes: Map<string, string[]> = new Map();
  for (const label in configObject) {
    if (typeof configObject[label] === 'string') {
      labelRegexes.set(label, [configObject[label]]);
    } else if (Array.isArray(configObject[label])) {
      labelRegexes.set(label, configObject[label]);
    } else {
      throw Error(
        `found unexpected type for label ${label} (should be string or array of regex)`
      );
    }
  }

  return labelRegexes;
}

function checkRegexes(issue_body: string, regexes: string[]): boolean {

  // If several regex entries are provided we require all of them to match for the label to be applied.
  for (const regEx of regexes) {
    const found = issue_body.match(regEx)
    if (!found)
    {
      return false;
    }
  }
  return true;
}

async function getLabels(
  client: github.GitHub,
  issue_number: number,
): Promise<string[]> {
  const response = await client.issues.listLabelsOnIssue({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue_number,
  });
  const data = response.data
  if (response.status != 200) {
    console.log('Unable to load labels. Exiting...')
    process.exit(1);
  }
  const labels: string[] = [];
  for (let i = 0; i < Object.keys(data).length; i++) {
    labels.push(data[i].name)
  }
  return labels;
}

async function addLabels(
  client: github.GitHub,
  issue_number: number,
  labels: string[]
) {
  await client.issues.addLabels({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue_number,
    labels: labels
  });
}

async function removeLabel(
  client: github.GitHub,
  issue_number: number,
  name: string
) {
  await client.issues.removeLabel({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: issue_number,
    name: name
  });
}

run();