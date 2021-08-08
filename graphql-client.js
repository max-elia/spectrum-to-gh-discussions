const fetch = require('node-fetch');

// CONFIG
const repositoryId = 'MDEwOlJlcG9zaXRvcnkyMTg3OTUxNjM='
const categoryId = 'DIC_kwDODQqMm84B-eEb'
const repoName = 'glsp'
const repoOwner = 'eclipse-glsp'

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

  const json = await response.json();
  console.log(json.data);
}

async function postDiscussion(thread) {
  const first = thread.shift();
  const discussionId = await createDiscussion(first.body, first.title, first.accessToken);

  for (const comment of thread) {
    await addDiscussionComment(comment.body, discussionId, comment.accessToken);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
}


async function getAllDiscussionIds() {
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
        'Authorization': `Bearer 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`,
        'User-Agent': 'Node',
      },
    }
  );
  const json = await response.json();
  console.log(json.data.repository.discussions.edges);
  return json.data.repository.discussions.edges;
}

async function deleteDiscussion(id, accessToken) {
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