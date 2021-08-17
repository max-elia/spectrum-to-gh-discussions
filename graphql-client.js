const fetch = require('node-fetch');

// CONFIG
const repositoryId = 'MDEwOlJlcG9zaXRvcnkyMTg3OTUxNjM='
const categoryId = 'DIC_kwDODQqMm84B-eEb'
const repoName = 'glsp'
const repoOwner = 'eclipse-glsp'

async function checkLimit(accessToken) {
  const data = JSON.stringify({
    query: `{
  viewer {
    login
  }
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
}`
  });
  const response = await fetch(
    'https://api.github.com/graphql',
    {
      method: 'post',
      body: data,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Node',
      },
    }
  );
  
  if (response.status !== 200) return undefined;

  const json = await response.json();
  return json.data;
}

async function createDiscussion(body, title, accessToken) {
  const data = JSON.stringify({
    query: `mutation {
	createDiscussion(input: {repositoryId: "${repositoryId}",categoryId: "${categoryId}", body: "${body}", title: "${title}"}) {
	  discussion {
      id
    }
	}
}`,
  });
  const response = await fetch(
    'https://api.github.com/graphql',
    {
      method: 'post',
      body: data,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Node',
      },
    }
  );

  if (response.status !== 200) return undefined;

  const json = await response.json();
  console.log(json.data);
  return json.data.createDiscussion.discussion.id;
}

async function addDiscussionComment(body, discussionId, accessToken) {
  const data = JSON.stringify({
    query: `mutation {
	addDiscussionComment(input: {body: "${body}", discussionId: "${discussionId}"}) {
	  comment {id}
	}
}`,
  });
  
  const response = await fetch(
    'https://api.github.com/graphql',
    {
      method: 'post',
      body: data,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Node',
      },
    }
  );
  if (response.status !== 200) return undefined;
  const json = await response.json();
  console.log(json.data);
  return response.status === 200
}

async function postDiscussion(thread) {
  const first = thread.shift();
  const limit = await checkLimit(first.accessToken);
  if (!limit || limit.rateLimit.remaining < 100) {
    thread.unshift(first);
    return {
      status: undefined, message: `Low RateLimit for user ${limit.viewer.login}
Remaining RateLimit: ${limit.rateLimit.remaining}
RateLimit will be reset at ${new Date(limit.rateLimit.resetAt)}`}
  } else {
    console.log(`Remaining RateLimit for user ${limit.viewer.login}: ${limit.rateLimit.remaining}`)
  }
  const discussionId = await createDiscussion(first.body, first.title, first.accessToken);
  if (!discussionId) {
    thread.unshift(first);
    return {status: undefined, message:`Unable to createDiscussion ${first.title}`};
  }
  await new Promise(resolve => setTimeout(resolve, 3000));

  for (const comment of thread) {
    const limit = await checkLimit(comment.accessToken);
    if (!limit || limit.rateLimit.remaining < 100) {
      thread.unshift(first);
      return {
        status: undefined,
        message: `Low RateLimit for user ${limit.viewer.login}
Remaining RateLimit: ${limit.rateLimit.remaining}
RateLimit will be reset at ${new Date(limit.rateLimit.resetAt)}`
      }
    } else {
      console.log(`Remaining RateLimit for user ${limit.viewer.login}: ${limit.rateLimit.remaining}`)
    }
    const res = await addDiscussionComment(comment.body, discussionId, comment.accessToken);
    if (!res){
    return {status: undefined, message:`Unable to add Comment '${comment.body}'`};
  }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return {status: true, message: `Discussion '${first.title}' created with id ${discussionId}`}
}


async function getAllDiscussionIds(accessToken) {
  const limit = await checkLimit(accessToken);
  if (!limit || limit.rateLimit.remaining < 1000) {
    console.log(`Low RateLimit for user ${limit.viewer.login}
Remaining RateLimit: ${limit.rateLimit.remaining}
RateLimit will be reset at ${new Date(limit.rateLimit.resetAt)}`)
    return undefined
  } else {
    console.log(`Remaining RateLimit for user ${limit.viewer.login}: ${limit.rateLimit.remaining}`)
  }
  const data = JSON.stringify({
    query: `{
  repository(name: "${repoName}", owner: "${repoOwner}") {
    discussions(first:100){
      edges {
        node {
          id
        }
      }
    }
  }
}`,
  });
  const response = await fetch(
    'https://api.github.com/graphql',
    {
      method: 'post',
      body: data,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Node',
      },
    }
  );
  const json = await response.json();
  console.log(json.data.repository.discussions.edges);
  return json.data.repository.discussions.edges;
}

async function deleteDiscussion(id, accessToken) {
  const limit = await checkLimit(accessToken);
  if (!limit || limit.rateLimit.remaining < 100) {
    console.log(`Low RateLimit for user ${limit.viewer.login}
Remaining RateLimit: ${limit.rateLimit.remaining}
RateLimit will be reset at ${new Date(limit.rateLimit.resetAt)}`)
    return undefined
  }
  const data = JSON.stringify({
    query: `mutation {
	deleteDiscussion(input: {id: "${id}"}){
		discussion {
      id
    }
  }
}`,
  });
  const response = await fetch(
    'https://api.github.com/graphql',
    {
      method: 'post',
      body: data,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Node',
      },
    }
  );
  const json = await response.json();
  console.log(json.data);
}

module.exports = { postDiscussion, deleteDiscussion, getAllDiscussionIds };