const axios = require("axios");

// Configurations
// We remove the query params here because we will manage them in the loop
const HUBSPOT_OWNERS_URL = "https://api.hubapi.com/crm/v3/owners/";
const AIRCALL_USERS_URL = "https://api.aircall.io/v1/users";

/**
 * FETCH ALL HUBSPOT OWNERS (LOOPED)
 * Returns a map: { 'email@domain.com': 'HubSpot_ID' }
 */
async function getHubSpotOwners() {
  let allOwners = [];
  let nextAfter = null; // The "bookmark" for the next page
  let hasMore = true;

  try {
    while (hasMore) {
      // Prepare query parameters
      const params = { limit: 100 };
      if (nextAfter) params.after = nextAfter;

      const response = await axios.get(HUBSPOT_OWNERS_URL, {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        },
        params: params,
      });

      // Add this batch to our big list
      allOwners = allOwners.concat(response.data.results);

      // Check if there are more pages
      if (
        response.data.paging &&
        response.data.paging.next &&
        response.data.paging.next.after
      ) {
        nextAfter = response.data.paging.next.after;
      } else {
        hasMore = false; // Stop looping
      }
    }

    // Convert array to Map { email: id }
    const emailToIdMap = {};
    allOwners.forEach((owner) => {
      if (owner.email) {
        emailToIdMap[owner.email.toLowerCase()] = owner.id;
      }
    });
    console.log(`✅ Fetched ${allOwners.length} HubSpot Owners.`);
    return emailToIdMap;
  } catch (error) {
    console.error("❌ Error fetching HubSpot Owners:", error.message);
    return {};
  }
}

/**
 * FETCH ALL AIRCALL USERS (LOOPED)
 * Returns a list of users with email and ID
 */
async function getAircallUsers() {
  let allUsers = [];
  // Start with page 1, asking for 50 users per page
  let nextPageLink = AIRCALL_USERS_URL + "?per_page=50";
  let pageCount = 1;

  // 1. SAFETY CHECK: Ensure keys are loaded
  if (!process.env.AIRCALL_API_ID || !process.env.AIRCALL_API_TOKEN) {
    console.error("❌ CRITICAL: Aircall API Keys are missing from .env file.");
    return [];
  }

  try {
    // 2. ENCODE CREDENTIALS
    const authString = Buffer.from(
      `${process.env.AIRCALL_API_ID}:${process.env.AIRCALL_API_TOKEN}`
    ).toString("base64");

    // 3. START LOOPING
    while (nextPageLink) {
      console.log(`   ↳ Fetching Aircall Users (Page ${pageCount})...`);

      const response = await axios.get(nextPageLink, {
        headers: { Authorization: `Basic ${authString}` },
      });

      const users = response.data.users || [];
      allUsers = allUsers.concat(users);

      // Check if there is a next page
      if (response.data.meta && response.data.meta.next_page_link) {
        nextPageLink = response.data.meta.next_page_link;
        pageCount++;
      } else {
        nextPageLink = null; // Stop the loop
      }
    }

    console.log(`✅ Fetched ${allUsers.length} Aircall Users.`);
    return allUsers;
  } catch (error) {
    // 4. DETAILED ERROR LOGGING
    console.error("❌ Error fetching Aircall Users:");

    if (error.response) {
      // The server responded with a status code other than 2xx
      console.error(
        `   Status: ${error.response.status} ${error.response.statusText}`
      );
      console.error(`   Reason:`, JSON.stringify(error.response.data, null, 2));
    } else {
      // Something happened in setting up the request
      console.error(`   Message: ${error.message}`);
    }
    return [];
  }
}

/**
 * BUILD THE MAP
 * Matches them by email and returns: { 'HubSpot_ID': 'Aircall_ID' }
 */
async function buildUserMap() {
  console.log("🔄 Syncing Users from HubSpot & Aircall...");

  const [hubspotEmails, aircallUsers] = await Promise.all([
    getHubSpotOwners(),
    getAircallUsers(),
  ]);

  const finalMap = {};
  let matchCount = 0;

  aircallUsers.forEach((aircallUser) => {
    const email = aircallUser.email.toLowerCase();

    if (hubspotEmails[email]) {
      const hubspotId = hubspotEmails[email];
      const aircallId = aircallUser.id;
      finalMap[hubspotId] = aircallId;
      matchCount++;
    }
  });

  console.log(`✅ Sync Complete! Mapped ${matchCount} users.`);
  return finalMap;
}

module.exports = buildUserMap;
