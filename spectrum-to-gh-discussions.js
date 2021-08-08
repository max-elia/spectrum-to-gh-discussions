const fs = require('fs');
const https = require('https');
const ghAPI = require('./graphql-client');

// Map Spectrum usernames to Personal Access Tokens of corresponding Github-Accounts
// Tokens can be generated at https://github.com/settings/tokens and should have options 'public_repo' and 'write:discussion' enabled
const githubUsers = {
  'maximilian-koegel': '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',
  'jhelming': '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',
  'eneufeld': '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',
  'camille-letavernier': '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',
  'tortmayr': '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',
  'planger': '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',
  'martin-fleck': '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',
}

// All threads written not by tokens defined in githubUsers will be posted under this account.
const defaultAccessToken = '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'

function fetchSpectrumAPI(data) {
  var postData = JSON.stringify(data);
  var options = {
    hostname: 'spectrum.chat',
    port: 443,
    path: '/api',
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:73.0) Gecko/20100101 Firefox/73.0',
      'Content-Type': 'application/json',
      'Content-Length': postData.length,
      'Origin': 'https://spectrum.chat',
      /* TODO: Replace all occurrencces of 'https://spectrum.chat/jsonforms' with your own Spectrum URL */
      'Referer': 'https://spectrum.chat/glsp?tab=posts',
      /* TODO: Copy your own cookies below, e.g. sign in with your browser and copy cookies from your browser devtools */
      'Cookie': '_now_no_cache=1; _ga=[REDACTED]; amplitude_id_undefinedspectrum.chat=[REDACTED]; session=[REDACTED]; session.sig=[REDACTED]; _gid=[REDACTED]; _gat=1'
    }
  };

  return new Promise((resolve, reject) => {
    var req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
      });
      res.on('error', error => reject);
      res.on('end', () => { resolve({res, body}); });
    });

    req.on('error', reject);

    req.write(postData);
    req.end();
  });
}

// Operational Transformation algorithm (insert)
function adjustRanges(ranges, index, insert) {
  if (!ranges) {
    return;
  }
  for (const range of ranges.reverse()) {
    if (range.offset > index) {
      range.offset += insert.length;
    } else if (range.offset + range.length >= index) {
      range.length += insert.length;
    } else {
      continue;
    }
  }
}

// Blocks is an internal Spectrum representation. Raw is a Discourse HTML post.
function blocksToBody(blocks, entityMap) {
  return blocks.map(b => {
    if (b.text && b.text.length > 0) {
      if (b.entityRanges.length > 0) {
        for (const range of b.entityRanges.reverse()) {
          let i = range.offset + range.length;
          const entity = entityMap[range.key];
          if (entity.type === 'IMAGE') {
            const insert = `[${entity.data.alt || 'image'}](${entity.data.src})`;
            b.text = b.text.slice(0, i) + insert + b.text.slice(i);
            adjustRanges(b.inlineStyleRanges, i, insert);
            continue;
          }
          if (entity.type === 'LINK' || entity.data.type === 'youtube') {
            const insert2 = `](${entity.data.url})`;
            b.text = b.text.slice(0, i) + insert2 + b.text.slice(i);
            adjustRanges(b.inlineStyleRanges, i, insert2);
            i -= range.length;
            const insert1 = `[`;
            b.text = b.text.slice(0, i) + insert1 + b.text.slice(i);
            adjustRanges(b.inlineStyleRanges, i, insert1);
            continue;
          }
          if (entity.data.id) {
            const urls = threadUrls[entity.data.id.split('?')[0]];
            if (entity.data.entity === 'thread' && urls) {
              const insert = urls.discourse || urls.spectrum;
              b.text = b.text.slice(0, i) + insert + b.text.slice(i);
              adjustRanges(b.inlineStyleRanges, i, insert);
              continue;
            }
          }
          console.error('unsupported entity!', entity);
        }
      }
      // Looks like: "inlineStyleRanges":[{"offset":63,"length":37,"style":"CODE"},{"offset":112,"length":16,"style":"CODE"}]
      for (const range of (b.inlineStyleRanges || []).reverse()) {
        let i = range.offset + range.length;
        switch (range.style) {
          case 'CODE':
            b.text = b.text.slice(0, i) + '```' + b.text.slice(i);
            i -= range.length;
            b.text = b.text.slice(0, i) + '```' + b.text.slice(i);
            break;
          case 'ITALIC':
            b.text = b.text.slice(0, i) + '*' + b.text.slice(i);
            i -= range.length;
            b.text = b.text.slice(0, i) + '*' + b.text.slice(i);
            break;
          case 'BOLD':
            b.text = b.text.slice(0, i) + '**' + b.text.slice(i);
            i -= range.length;
            b.text = b.text.slice(0, i) + '**' + b.text.slice(i);
            break;
          default:
            console.error('unknown style range', range);
        }
      }
      switch (b.type) {
        case 'unstyled':
          break;
        case 'atomic':
          b.text = b.text.replace(/^ /, '');;
          break;
        case 'blockquote':
          b.text = '> ' + b.text;
          break;
        case 'ordered-list-item':
          b.text = '1. ' + b.text;
          break;
        case 'unordered-list-item':
          b.text = '- ' + b.text;
          break;
        case 'code-block':
          b.text = b.text.replace(/^(<code>)?/, '```\n').replace(/(<\/code>)?$/, '\n```');
          break;
        case 'header-one':
          b.text = '# ' + b.text;
          break;
        case 'header-two':
          b.text = '## ' + b.text;
          break;
        case 'header-three':
          b.text = '### ' + b.text;
          break;
        case 'header-four':
          b.text = '#### ' + b.text;
          break;
        case 'header-five':
          b.text = '##### ' + b.text;
          break;
        default:
          console.error('unknown text block type:', b.type, b);
      }
      return b.text.replace(/\"/g, '\'').replace(/\\/g, '\\\\');
    }
    console.error('unsupported block!', b);
    return '';
  }).join('\n\n');
}

async function threadConnectionToThreads(threadConnection) {
  let threads = threadConnection.edges.map(edge => {
    const {blocks, entityMap} = JSON.parse(edge.node.content.body);
    const url = `https://spectrum.chat/glsp/${edge.node.channel.slug}/${edge.node.content.title.toLowerCase().replace(/[^a-z\s]/g,'').replace(/\s+/g,'-')}~${edge.node.id}`;
    if (!threadUrls[edge.node.id]) {
      threadUrls[edge.node.id] = {};
    }
    threadUrls[edge.node.id].spectrum = url;
    let thread = [{
      id: edge.node.id,
      messageCount: edge.node.messageCount,
      created_at: edge.node.createdAt,
      title: edge.node.content.title,
      body: blocksToBody(blocks, entityMap).replace(/"/g, '\"') + `\n\n*[original thread](${url}) by ${edge.node.author.user.name}*`,
      accessToken: githubUsers[edge.node.author.user.username] || defaultAccessToken
    }];
    return thread;
  });
  for (const thread of threads) {
    if (thread[0].messageCount > 0) {
      let messages = await fetchSpectrumMessages(thread[0].id);
      for (const message of messages) { thread.push(message); }
    }
  }
  return threads;
}

async function fetchSpectrumThreads() {
    // Note: I reverse-engineered these Spectrum payloads by using Spectrum in my browser and inspecting the API requests.
    const {res, body} = await fetchSpectrumAPI({"operationName":"getCommunityThreadConnection","variables":{"id":"33fad6af-1415-4fd3-a893-e247e089b055","after":null,"sort":"latest"},"query":"query getCommunityThreadConnection($id: ID, $after: String, $sort: CommunityThreadConnectionSort) {\n  community(id: $id) {\n    ...communityInfo\n    ...communityThreadConnection\n    __typename\n  }\n}\n\nfragment threadInfo on Thread {\n  id\n  messageCount\n  createdAt\n  modifiedAt\n  lastActive\n  receiveNotifications\n  currentUserLastSeen\n  editedBy {\n    ...threadParticipant\n    __typename\n  }\n  author {\n    ...threadParticipant\n    __typename\n  }\n  channel {\n    ...channelInfo\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  isPublished\n  isLocked\n  isAuthor\n  type\n  content {\n    title\n    body\n    __typename\n  }\n  attachments {\n    attachmentType\n    data\n    __typename\n  }\n  watercooler\n  metaImage\n  reactions {\n    count\n    hasReacted\n    __typename\n  }\n  __typename\n}\n\nfragment threadParticipant on ThreadParticipant {\n  user {\n    ...userInfo\n    __typename\n  }\n  isMember\n  isModerator\n  isBlocked\n  isOwner\n  roles\n  reputation\n  __typename\n}\n\nfragment userInfo on User {\n  id\n  profilePhoto\n  coverPhoto\n  name\n  firstName\n  description\n  website\n  username\n  isOnline\n  timezone\n  totalReputation\n  betaSupporter\n  __typename\n}\n\nfragment channelInfo on Channel {\n  id\n  name\n  slug\n  description\n  isPrivate\n  createdAt\n  isArchived\n  channelPermissions {\n    isMember\n    isPending\n    isBlocked\n    isOwner\n    isModerator\n    receiveNotifications\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  __typename\n}\n\nfragment communityInfo on Community {\n  id\n  createdAt\n  name\n  slug\n  description\n  website\n  profilePhoto\n  coverPhoto\n  pinnedThreadId\n  isPrivate\n  watercoolerId\n  lastActive\n  communityPermissions {\n    isMember\n    isBlocked\n    isOwner\n    isPending\n    isModerator\n    reputation\n    lastSeen\n    __typename\n  }\n  brandedLogin {\n    isEnabled\n    message\n    __typename\n  }\n  __typename\n}\n\nfragment communityMetaData on Community {\n  metaData {\n    members\n    onlineMembers\n    __typename\n  }\n  __typename\n}\n\nfragment communityThreadConnection on Community {\n  pinnedThread {\n    ...threadInfo\n    __typename\n  }\n  watercooler {\n    ...threadInfo\n    __typename\n  }\n  threadConnection(first: 10, after: $after, sort: $sort) {\n    pageInfo {\n      hasNextPage\n      hasPreviousPage\n      __typename\n    }\n    edges {\n      cursor\n      node {\n        ...threadInfo\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  __typename\n}\n"});
  console.log('Spectrum API posts', res.statusCode);
  let {data} = JSON.parse(body);
  let threadConnection = data.community.threadConnection;
  let threads = await threadConnectionToThreads(threadConnection);
  while (threadConnection.pageInfo.hasNextPage) {
    const {res: re, body: bo} = await fetchSpectrumAPI({"operationName":"loadMoreCommunityThreads","variables":{"after":threadConnection.edges[threadConnection.edges.length-1].cursor,"id":"33fad6af-1415-4fd3-a893-e247e089b055"},"query":"query loadMoreCommunityThreads($after: String, $id: ID, $sort: CommunityThreadConnectionSort) {\n  community(id: $id) {\n    ...communityInfo\n    ...communityThreadConnection\n    __typename\n  }\n}\n\nfragment threadInfo on Thread {\n  id\n  messageCount\n  createdAt\n  modifiedAt\n  lastActive\n  receiveNotifications\n  currentUserLastSeen\n  editedBy {\n    ...threadParticipant\n    __typename\n  }\n  author {\n    ...threadParticipant\n    __typename\n  }\n  channel {\n    ...channelInfo\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  isPublished\n  isLocked\n  isAuthor\n  type\n  content {\n    title\n    body\n    __typename\n  }\n  attachments {\n    attachmentType\n    data\n    __typename\n  }\n  watercooler\n  metaImage\n  reactions {\n    count\n    hasReacted\n    __typename\n  }\n  __typename\n}\n\nfragment threadParticipant on ThreadParticipant {\n  user {\n    ...userInfo\n    __typename\n  }\n  isMember\n  isModerator\n  isBlocked\n  isOwner\n  roles\n  reputation\n  __typename\n}\n\nfragment userInfo on User {\n  id\n  profilePhoto\n  coverPhoto\n  name\n  firstName\n  description\n  website\n  username\n  isOnline\n  timezone\n  totalReputation\n  betaSupporter\n  __typename\n}\n\nfragment channelInfo on Channel {\n  id\n  name\n  slug\n  description\n  isPrivate\n  createdAt\n  isArchived\n  channelPermissions {\n    isMember\n    isPending\n    isBlocked\n    isOwner\n    isModerator\n    receiveNotifications\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  __typename\n}\n\nfragment communityInfo on Community {\n  id\n  createdAt\n  name\n  slug\n  description\n  website\n  profilePhoto\n  coverPhoto\n  pinnedThreadId\n  isPrivate\n  watercoolerId\n  lastActive\n  communityPermissions {\n    isMember\n    isBlocked\n    isOwner\n    isPending\n    isModerator\n    reputation\n    lastSeen\n    __typename\n  }\n  brandedLogin {\n    isEnabled\n    message\n    __typename\n  }\n  __typename\n}\n\nfragment communityMetaData on Community {\n  metaData {\n    members\n    onlineMembers\n    __typename\n  }\n  __typename\n}\n\nfragment communityThreadConnection on Community {\n  pinnedThread {\n    ...threadInfo\n    __typename\n  }\n  watercooler {\n    ...threadInfo\n    __typename\n  }\n  threadConnection(first: 10, after: $after, sort: $sort) {\n    pageInfo {\n      hasNextPage\n      hasPreviousPage\n      __typename\n    }\n    edges {\n      cursor\n      node {\n        ...threadInfo\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  __typename\n}\n"});
    console.log('Spectrum API more posts', re.statusCode);
    if (re.statusCode === 503) {
      console.log('Rate limit!', re.statusCode, bo);
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    threadConnection = JSON.parse(bo).data.community.threadConnection;
    threads = threads.concat(await threadConnectionToThreads(threadConnection));
  }
  return threads;
}

async function messageConnectionToMessages(messageConnection) {
  let messages = messageConnection.edges.map(edge => {
    let message = {
      created_at: edge.node.timestamp,
      accessToken: githubUsers[edge.node.author.user.username] || defaultAccessToken,
      body: ''
    };
    if (message.accessToken === defaultAccessToken) {
      message.body += `*[${edge.node.author.user.name}]*\n\n`;
    }
    try {
      const {blocks, entityMap} = JSON.parse(edge.node.content.body);
      message.body += blocksToBody(blocks, entityMap);
      if (!message.body) {
        console.log('message', message, 'edge', edge);
      }
    } catch (error) {
      console.error(error, edge.node.content.body);
      message.body += edge.node.content.body;
    }
    return message;
  }).sort((a,b) => {
    if(a.created_at < b.created_at) { return -1; }
    if(a.created_at > b.created_at) { return 1; }
    return 0;
  });
  return messages;
}

async function fetchSpectrumMessages(threadId, includeFirst = false) {
  const {res, body} = await fetchSpectrumAPI( {"operationName":"getThreadMessages","variables":{"id":threadId,"first":25},"query":"query getThreadMessages($id: ID!, $after: String, $first: Int, $before: String, $last: Int) {\n  thread(id: $id) {\n    ...threadInfo\n    ...threadMessageConnection\n    __typename\n  }\n}\n\nfragment threadInfo on Thread {\n  id\n  messageCount\n  createdAt\n  modifiedAt\n  lastActive\n  receiveNotifications\n  currentUserLastSeen\n  editedBy {\n    ...threadParticipant\n    __typename\n  }\n  author {\n    ...threadParticipant\n    __typename\n  }\n  channel {\n    ...channelInfo\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  isPublished\n  isLocked\n  isAuthor\n  type\n  content {\n    title\n    body\n    __typename\n  }\n  attachments {\n    attachmentType\n    data\n    __typename\n  }\n  watercooler\n  metaImage\n  reactions {\n    count\n    hasReacted\n    __typename\n  }\n  __typename\n}\n\nfragment threadParticipant on ThreadParticipant {\n  user {\n    ...userInfo\n    __typename\n  }\n  isMember\n  isModerator\n  isBlocked\n  isOwner\n  roles\n  reputation\n  __typename\n}\n\nfragment userInfo on User {\n  id\n  profilePhoto\n  coverPhoto\n  name\n  firstName\n  description\n  website\n  username\n  isOnline\n  timezone\n  totalReputation\n  betaSupporter\n  __typename\n}\n\nfragment channelInfo on Channel {\n  id\n  name\n  slug\n  description\n  isPrivate\n  createdAt\n  isArchived\n  channelPermissions {\n    isMember\n    isPending\n    isBlocked\n    isOwner\n    isModerator\n    receiveNotifications\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  __typename\n}\n\nfragment communityInfo on Community {\n  id\n  createdAt\n  name\n  slug\n  description\n  website\n  profilePhoto\n  coverPhoto\n  pinnedThreadId\n  isPrivate\n  watercoolerId\n  lastActive\n  communityPermissions {\n    isMember\n    isBlocked\n    isOwner\n    isPending\n    isModerator\n    reputation\n    lastSeen\n    __typename\n  }\n  brandedLogin {\n    isEnabled\n    message\n    __typename\n  }\n  __typename\n}\n\nfragment communityMetaData on Community {\n  metaData {\n    members\n    onlineMembers\n    __typename\n  }\n  __typename\n}\n\nfragment threadMessageConnection on Thread {\n  messageConnection(after: $after, first: $first, before: $before, last: $last) {\n    pageInfo {\n      hasNextPage\n      hasPreviousPage\n      __typename\n    }\n    edges {\n      cursor\n      node {\n        ...messageInfo\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  __typename\n}\n\nfragment messageInfo on Message {\n  id\n  timestamp\n  modifiedAt\n  messageType\n  bot\n  parent {\n    id\n    timestamp\n    messageType\n    author {\n      ...threadParticipant\n      __typename\n    }\n    content {\n      body\n      __typename\n    }\n    __typename\n  }\n  author {\n    ...threadParticipant\n    __typename\n  }\n  reactions {\n    count\n    hasReacted\n    __typename\n  }\n  content {\n    body\n    __typename\n  }\n  __typename\n}\n"});
  console.log('Spectrum API thread', res.statusCode);
  if (res.statusCode === 503) {
    console.log('Rate limit!', res.statusCode, threadId, body);
    await new Promise(resolve => setTimeout(resolve, 300));
    return fetchSpectrumMessages(threadId, includeFirst);
  }
  if (res.statusCode !== 200) {
    console.log('failed to fetch thread', threadId, body);
  }
  let thread = JSON.parse(body).data.thread;
  let messageConnection = thread.messageConnection;
  if (includeFirst) {
    messageConnection.edges.unshift({node: thread});
  }
  let messages = await messageConnectionToMessages(messageConnection);
  if (includeFirst) {
    // This is a hack to include the original Spectrum comment in the list of replies, if needed.
    messages[0].id = thread.id;
    messages[0].messageCount = thread.messageCount;
    messages[0].created_at = thread.createdAt;
    messages[0].title = thread.content.title;
  }
  while (messageConnection.pageInfo.hasNextPage) {
    const {res: re, body: bo} = await fetchSpectrumAPI( {"operationName":"getThreadMessages","variables":{"after":messageConnection.edges[messageConnection.edges.length-1].cursor,"id":threadId,"first":25},"query":"query getThreadMessages($id: ID!, $after: String, $first: Int, $before: String, $last: Int) {\n  thread(id: $id) {\n    ...threadInfo\n    ...threadMessageConnection\n    __typename\n  }\n}\n\nfragment threadInfo on Thread {\n  id\n  messageCount\n  createdAt\n  modifiedAt\n  lastActive\n  receiveNotifications\n  currentUserLastSeen\n  editedBy {\n    ...threadParticipant\n    __typename\n  }\n  author {\n    ...threadParticipant\n    __typename\n  }\n  channel {\n    ...channelInfo\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  isPublished\n  isLocked\n  isAuthor\n  type\n  content {\n    title\n    body\n    __typename\n  }\n  attachments {\n    attachmentType\n    data\n    __typename\n  }\n  watercooler\n  metaImage\n  reactions {\n    count\n    hasReacted\n    __typename\n  }\n  __typename\n}\n\nfragment threadParticipant on ThreadParticipant {\n  user {\n    ...userInfo\n    __typename\n  }\n  isMember\n  isModerator\n  isBlocked\n  isOwner\n  roles\n  reputation\n  __typename\n}\n\nfragment userInfo on User {\n  id\n  profilePhoto\n  coverPhoto\n  name\n  firstName\n  description\n  website\n  username\n  isOnline\n  timezone\n  totalReputation\n  betaSupporter\n  __typename\n}\n\nfragment channelInfo on Channel {\n  id\n  name\n  slug\n  description\n  isPrivate\n  createdAt\n  isArchived\n  channelPermissions {\n    isMember\n    isPending\n    isBlocked\n    isOwner\n    isModerator\n    receiveNotifications\n    __typename\n  }\n  community {\n    ...communityInfo\n    ...communityMetaData\n    __typename\n  }\n  __typename\n}\n\nfragment communityInfo on Community {\n  id\n  createdAt\n  name\n  slug\n  description\n  website\n  profilePhoto\n  coverPhoto\n  pinnedThreadId\n  isPrivate\n  watercoolerId\n  lastActive\n  communityPermissions {\n    isMember\n    isBlocked\n    isOwner\n    isPending\n    isModerator\n    reputation\n    lastSeen\n    __typename\n  }\n  brandedLogin {\n    isEnabled\n    message\n    __typename\n  }\n  __typename\n}\n\nfragment communityMetaData on Community {\n  metaData {\n    members\n    onlineMembers\n    __typename\n  }\n  __typename\n}\n\nfragment threadMessageConnection on Thread {\n  messageConnection(after: $after, first: $first, before: $before, last: $last) {\n    pageInfo {\n      hasNextPage\n      hasPreviousPage\n      __typename\n    }\n    edges {\n      cursor\n      node {\n        ...messageInfo\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  __typename\n}\n\nfragment messageInfo on Message {\n  id\n  timestamp\n  modifiedAt\n  messageType\n  bot\n  parent {\n    id\n    timestamp\n    messageType\n    author {\n      ...threadParticipant\n      __typename\n    }\n    content {\n      body\n      __typename\n    }\n    __typename\n  }\n  author {\n    ...threadParticipant\n    __typename\n  }\n  reactions {\n    count\n    hasReacted\n    __typename\n  }\n  content {\n    body\n    __typename\n  }\n  __typename\n}\n"});
    console.log('Spectrum API more messages', re.statusCode);
    if (re.statusCode === 503) {
      console.log('Rate limit!', re.statusCode, bo);
      await new Promise(resolve => setTimeout(resolve, 300));
      continue;
    }
    messageConnection = JSON.parse(bo).data.thread.messageConnection;
    messages = messages.concat(await messageConnectionToMessages(messageConnection));
  }
  return messages;
}

// THE MAIN FUNCTION
// Here you can see how the various functions are used, and you can comment out what you don't want to run.
(async () => {
  try {
    
    // Fetch all Spectrum threads and import them all into Github Discussion
    const threads = await fetchSpectrumThreads();
    console.log('threads', threads);
    threads.reverse();
    // Save fetched threads into a backup file (useful for later verification):
    fs.writeFileSync('./spectrum-threads.json', JSON.stringify(threads, null, 2), 'utf-8');

    // // After spectrum threads have been fetched and saved to file, threads can be read frome here
    // const threads = JSON.parse(fs.readFileSync('./spectrum-threads.json', 'utf-8'));

    for (const thread of threads) {
      await ghAPI.postDiscussion(thread);
    }

    // Delete all discussions
    // const nodes = await ghAPI.getAllDiscussionIds();
    // for (const node of nodes) {
    //   ghAPI.deleteDiscussion(node.node.id, defaultAccessToken);
    // }

  } catch (error) {
    console.error(error);
  }
})();

var threadUrls = {}; // JSON.parse(fs.readFileSync('./spectrum-thread-urls.json', 'utf-8'));