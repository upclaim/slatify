import * as github from '@actions/github';
import {Octokit} from '@octokit/rest';
import {MessageAttachment, MrkdwnElement} from '@slack/types';
import {
  IncomingWebhook,
  IncomingWebhookSendArguments,
  IncomingWebhookResult,
  IncomingWebhookDefaultArguments
} from '@slack/webhook';
import {Context} from '@actions/github/lib/context';

interface Accessory {
  color: string;
  result: string;
}

class Block {
  readonly context: Context = github.context;

  public get success(): Accessory {
    return {
      color: '#2cbe4e',
      result: 'Succeeded'
    };
  }

  public get failure(): Accessory {
    return {
      color: '#cb2431',
      result: 'Failed'
    };
  }

  public get cancelled(): Accessory {
    return {
      color: '#ffc107',
      result: 'Cancelled'
    };
  }

  public get isPullRequest(): boolean {
    const {eventName} = this.context;
    return eventName === 'pull_request';
  }

  /**
   * Get MrkdwnElement fields including git commit data
   * @param {string} token
   * @returns {Promise<MrkdwnElement[]>}
   */
  public async getCommitFields(token: string): Promise<MrkdwnElement[]> {
    const {sha, eventName, workflow} = this.context;
    const {owner, repo} = this.context.repo;

    const {number} = this.context.issue;
    const repoUrl: string = `https://github.com/${owner}/${repo}`;
    let actionUrl: string = repoUrl;
    let eventUrl: string = eventName;

    const head_ref: string = process.env.GITHUB_REF as string;
    const ref: string = this.isPullRequest
      ? head_ref.replace(/refs\/heads\//, '')
      : this.context.sha;
    const client = new Octokit({auth: token});
    const {data: commit} = await client.repos.getCommit({owner, repo, ref});

    if (this.isPullRequest) {
      eventUrl = `<${repoUrl}/pull/${number}|Pull Request>`;
      actionUrl += `/pull/${number}/checks`;
    } else {
      actionUrl += `/commit/${sha}/checks`;
    }

    const commitMsg: string = commit.commit.message.split('\n')[0];
    const commitUrl: string = commit.html_url;

    const authorName: string = commit.author.login;
    const authorUrl: string = commit.author.html_url;

    const fields: MrkdwnElement[] = [
      {
        type: 'mrkdwn',
        text: `New ${eventUrl} by <${authorUrl}|${authorName}> on <${repoUrl}|${owner}/${repo}>\n*Build:* <${actionUrl}|${workflow}>`
      }
    ];

    return fields;
  }
}

export class Slack {
  /**
   * Check if message mention is needed
   * @param {string} mentionCondition mention condition
   * @param {string} status job status
   * @returns {boolean}
   */
  private isMention(condition: string, status: string): boolean {
    return condition === 'always' || condition === status;
  }

  /**
   * Generate slack payload
   * @param {string} jobName
   * @param {string} status
   * @param {string} mention
   * @param {string} mentionCondition
   * @returns {IncomingWebhookSendArguments}
   */
  public async generatePayload(
    successMessage: string,
    errorMessage: string,
    status: string,
    mention: string,
    mentionCondition: string,
    commitFlag: boolean,
    token?: string
  ): Promise<IncomingWebhookSendArguments> {
    const slackBlockUI = new Block();
    const notificationType: Accessory = slackBlockUI[status];

    let messageToDisplay = 'Cancelled build'
    if (status === 'success') messageToDisplay = successMessage
    else if (status === 'failure') messageToDisplay = errorMessage

    const text =
      mention && this.isMention(mentionCondition, status)
        ? `<!${mention}> ${messageToDisplay}`
        : messageToDisplay;
    let baseBlock = {
      type: 'context',
      elements: []
    };

    if (commitFlag && token) {
      const commitFields: MrkdwnElement[] = await slackBlockUI.getCommitFields(
        token
      );
      Array.prototype.push.apply(baseBlock.elements, commitFields);
    }

    const attachments: MessageAttachment = {
      color: notificationType.color,
      blocks: [baseBlock]
    };

    const payload: IncomingWebhookSendArguments = {
      text,
      attachments: [attachments],
      unfurl_links: true
    };

    return payload;
  }

  /**
   * Notify information about github actions to Slack
   * @param {IncomingWebhookSendArguments} payload
   * @returns {Promise<IncomingWebhookResult>} result
   */
  public async notify(
    url: string,
    options: IncomingWebhookDefaultArguments,
    payload: IncomingWebhookSendArguments
  ): Promise<void> {
    const client: IncomingWebhook = new IncomingWebhook(url, options);
    const response: IncomingWebhookResult = await client.send(payload);

    if (response.text !== 'ok') {
      throw new Error(`
      Failed to send notification to Slack
      Response: ${response.text}
      `);
    }
  }
}
