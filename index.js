require("dotenv").config();
const express = require("express");
const axios = require("axios");
const buildUserMap = require("./user_sync"); // Importing your new dynamic sync tool

const app = express();
app.use(express.json()); // Essential to parse Aircall's JSON data

// GLOBAL VARIABLE TO STORE THE MAP
// Format: { 'HubSpot_Owner_ID': 'Aircall_User_ID' }
let ownerMap = {};

// ==========================================
// 1. INITIALIZE & SCHEDULE SYNC
// ==========================================

// Run immediately when server starts
(async () => {
  try {
    console.log("🚀 Server starting... Building initial User Map.");
    ownerMap = await buildUserMap();
  } catch (error) {
    console.error("❌ Critical Error: Failed to build initial map.", error);
  }
})();

// Refresh map every 1 hour (3600000 ms)
// This ensures new hires are added automatically without restarting the server
setInterval(async () => {
  console.log("⏰ Scheduled Task: Refreshing User Map...");
  ownerMap = await buildUserMap();
}, 3600000);

// ==========================================
// 2. CONFIGURATION
// ==========================================
const HUBSPOT_SEARCH_URL =
  "https://api.hubapi.com/crm/v3/objects/contacts/search";

// ==========================================
// 3. MAIN ROUTE
// ==========================================
app.post("/aircall/route", async (req, res) => {
  console.log("📞 Incoming call request received...");

  // A. EXTRACT DATA
  // Aircall sends the number in: req.body.data.number
  const callerNumber = req.body.data ? req.body.data.number : null;

  if (!callerNumber) {
    console.log("❌ No number found in request. Falling back.");
    // Return empty JSON to let Aircall follow standard routing
    return res.status(200).json({});
  }

  console.log(`🔎 Searching HubSpot for: ${callerNumber}`);

  try {
    // B. QUERY HUBSPOT API
    // We search for the phone number to find the contact
    const hubspotResponse = await axios.post(
      HUBSPOT_SEARCH_URL,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "phone",
                operator: "CONTAINS_TOKEN", // Matches parts of numbers nicely
                value: callerNumber,
              },
            ],
          },
        ],
        properties: ["hubspot_owner_id"], // We only need the owner ID
        limit: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const results = hubspotResponse.data.results;

    // C. CHECK IF CONTACT EXISTS
    if (results.length === 0) {
      console.log("⚠️ Number not found in HubSpot.");
      return res.status(200).json({});
    }

    const contact = results[0];
    const hubspotOwnerId = contact.properties.hubspot_owner_id;

    if (!hubspotOwnerId) {
      console.log("⚠️ Contact found, but has NO owner.");
      return res.status(200).json({});
    }

    // D. TRANSLATE ID (The Magic Step)
    // We look up the HubSpot ID in our global 'ownerMap' variable
    const aircallUserId = ownerMap[hubspotOwnerId];

    if (!aircallUserId) {
      console.log(
        `⚠️ Owner found (HubSpot ID: ${hubspotOwnerId}), but they are not mapped to an Aircall User.`
      );
      console.log("Did you use the same email address in both systems?");
      return res.status(200).json({});
    }

    // E. SEND COMMAND TO AIRCALL
    console.log(`✅ Success! Routing to Aircall User ID: ${aircallUserId}`);

    return res.status(200).json({
      transfer_to: `user:${aircallUserId}`,
    });
  } catch (error) {
    // F. SAFETY NET
    console.error("🔥 Error processing call:", error.message);
    return res.status(200).json({});
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Smart Routing Server running on port ${PORT}`);
});

// LINE FOR VERCEL
module.exports = app;
