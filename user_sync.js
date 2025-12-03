const axios = require("axios");
const logger = require("./logger");

const HUBSPOT_OWNERS_URL = "https://api.hubapi.com/crm/v3/owners";
const AIRCALL_USERS_URL = "https://api.aircall.io/v1/users";

async function fetchHubSpotOwners() {
  const owners = [];
  let after;
  let page = 0;

  try {
    while (true) {
      page += 1;

      const response = await axios.get(HUBSPOT_OWNERS_URL, {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        params: {
          limit: 100,
          ...(after ? { after } : {}),
        },
        timeout: 8000,
      });

      const results = response.data.results || [];
      owners.push(...results);

      const next = response.data.paging?.next?.after;
      if (!next) break;
      after = next;
    }

    logger.info("hubspot_owners_fetched", {
      count: owners.length,
      pages: page,
    });

    return owners;
  } catch (error) {
    logger.error("hubspot_owners_fetch_error", {
      message: error.message,
      code: error.code,
      url: error.config?.url,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    });
    throw error;
  }
}

async function fetchAircallUsers() {
  try {
    const response = await axios.get(AIRCALL_USERS_URL, {
      auth: {
        username: process.env.AIRCALL_API_ID,
        password: process.env.AIRCALL_API_TOKEN,
      },
      timeout: 8000,
    });

    const users = response.data.users || [];

    logger.info("aircall_users_fetched", {
      count: users.length,
    });

    return users;
  } catch (error) {
    logger.error("aircall_users_fetch_error", {
      message: error.message,
      code: error.code,
      url: error.config?.url,
      responseStatus: error.response?.status,
      responseData: error.response?.data,
    });
    throw error;
  }
}

async function buildUserMap() {
  logger.info("user_sync_start");

  try {
    const [owners, users] = await Promise.all([
      fetchHubSpotOwners(),
      fetchAircallUsers(),
    ]);

    const aircallUsersByEmail = {};
    for (const user of users) {
      const email = (user.email || "").toLowerCase();
      if (!email) continue;
      aircallUsersByEmail[email] = user;
    }

    const map = {};
    let mapped = 0;

    for (const owner of owners) {
      const email = (owner.email || "").toLowerCase();
      const id = owner.id;

      if (!email || !id) continue;

      const aircallUser = aircallUsersByEmail[email];
      if (aircallUser && aircallUser.id) {
        map[id] = aircallUser.id;
        mapped += 1;
      }
    }

    logger.info("user_sync_complete", {
      hubspotOwners: owners.length,
      aircallUsers: users.length,
      mappedOwners: mapped,
    });

    return map;
  } catch (error) {
    logger.error("user_sync_failed", {
      message: error.message,
    });
    return {};
  }
}

module.exports = buildUserMap;
