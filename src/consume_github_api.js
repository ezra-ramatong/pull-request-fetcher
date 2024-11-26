const axios = require("axios").default;
const dotenv = require("dotenv");

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BASE_API_URL = `https://api.github.com`;

function getHeaders(url) {
  const config = {};

  if (GITHUB_TOKEN) {
    config.headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
    };
  }

  return axios.head(url, config);
}

function getPullsData(url) {
  config = {
    params: {
      state: "all",
      per_page: 100,
    },
  };

  if (GITHUB_TOKEN) {
    config.headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Cache-Control": "no-cache",
    };
  }

  return axios.get(url, config);
}

function validateStringNotEmpty(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected a string but received: ${typeof value}`);
  }

  if (!value || value.trim().length === 0) {
    throw new Error(`Expected a non-empty string but recieved an empty string`);
  }
}

async function verifyOwnerExists(owner) {
  validateStringNotEmpty(owner);

  const url = `${BASE_API_URL}/users/${owner}`;

  try {
    const response = await getHeaders(url);

    return response.status === 200;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`repository owner ${owner} not found`);
    } else {
      throw error;
    }
  }
}

async function verifyRepoExists({ repo, owner }) {
  validateStringNotEmpty(repo);

  const url = `${BASE_API_URL}/repos/${owner}/${repo}`;

  try {
    const response = await getHeaders(url);

    return response.status === 200;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`repository ${repo} for owner ${owner} not found`);
    } else {
      throw error;
    }
  }
}

function parseLinkHeader(header) {
  const links = {};
  const parts = header.split(",");
  parts.forEach((part) => {
    const [url, rel] = part.split(";");
    const cleanedUrl = url.replace(/<(.*)>/, "$1").trim();
    const cleanedRel = rel.replace(/rel="(.*)"/, "$1").trim();
    links[cleanedRel] = cleanedUrl;
  });
  return links;
}

async function getAllPullRequests(repo, owner) {
  let allPullRequests = [];
  let nextPageUrl = `${BASE_API_URL}/repos/${owner}/${repo}/pulls`;

  try {
    while (nextPageUrl) {
      const response = await getPullsData(nextPageUrl);

      allPullRequests = allPullRequests.concat(response.data);

      const linkHeader = response.headers.link;

      if (linkHeader) {
        const links = parseLinkHeader(linkHeader);
        nextPageUrl = links.next || null;
      } else {
        nextPageUrl = null;
      }
    }

    return allPullRequests;
  } catch (error) {
    throw error;
  }
}

function parseDate(dateString, isEndDate = false) {
  const date = new Date(dateString);

  if (isEndDate) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date;
}

function filterPullRequestsByDateRange(pulls, startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate, true);

  return pulls.filter((pull) => {
    const isDateInRange = (dateString) => {
      if (!dateString) return false;

      const date = new Date(dateString);
      return date >= start && date <= end;
    };

    return (
      isDateInRange(pull.created_at) ||
      isDateInRange(pull.updated_at) ||
      isDateInRange(pull.merged_at) ||
      isDateInRange(pull.closed_at)
    );
  });
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatObjectByKey(obj, keysToKeep) {
  return Object.fromEntries(
    Object.entries(obj)
      .map(([key, value]) => {
        if (keysToKeep.includes(key)) {
          if (key === "user" && typeof value === "object") {
            return [key, value.login];
          }

          if (
            key === "created_at" ||
            key === "updated_at" ||
            key === "closed_at" ||
            key === "merged_at"
          ) {
            return [key, formatDate(value)];
          }

          return [key, value];
        }

        return null;
      })
      .filter((entry) => entry !== null),
  );
}

function validateDateStrings(startDate, endDate) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;

  const isValidDate = (dateString) => {
    if (dateString.match(regex) === null) {
      return false;
    }

    const date = new Date(dateString);
    const timestamp = date.getTime();

    if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
      return false;
    }

    return date.toISOString().startsWith(dateString);
  };

  if (!isValidDate(startDate)) {
    throw new Error(`Invalid start date: ${startDate}`);
  }

  if (!isValidDate(endDate)) {
    throw new Error(`Invalid end date: ${endDate}`);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (end < start) {
    throw new Error(
      `End date ${endDate} cannot be before start date ${startDate}`,
    );
  }
}

async function getPullRequests({ owner, repo, startDate, endDate }) {
  validateDateStrings(startDate, endDate);

  const [ownerExists, repoExists, allPullRequests] = await Promise.allSettled([
    verifyOwnerExists(owner),
    verifyRepoExists({ repo, owner }),
    getAllPullRequests(repo, owner),
  ]);

  [ownerExists, repoExists, allPullRequests].forEach((promise) => {
    if (promise.status === "rejected") {
      throw promise.reason;
    }
  });

  const filteredPullRequests = filterPullRequestsByDateRange(
    allPullRequests.value,
    startDate,
    endDate,
  );

  const keysToKeep = ["id", "user", "title", "state", "created_at"];
  const formattedPullRequests = filteredPullRequests.map((item) =>
    formatObjectByKey(item, keysToKeep),
  );

  return formattedPullRequests;
}

module.exports = { getPullRequests };
