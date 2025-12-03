require("dotenv").config();
const express = require("express");
const axios = require("axios");
const buildUserMap = require("./user_sync");
const logger = require("./logger");

const app = express();
app.use(express.json());

let ownerMap = {};

// Initial sync of HubSpot owner → Aircall user map
(async () => {
  try {
    logger.info("user_map_initial_build_start");
    ownerMap = await buildUserMap();
    logger.info("user_map_initial_build_success", {
      ownerCount: Object.keys(ownerMap).length,
    });
  } catch (error) {
    logger.error("user_map_initial_build_failed", {
      error: error.message,
      stack: error.stack,
    });
  }
})();

// Periodic refresh
setInterval(async () => {
  try {
    logger.info("user_map_refresh_start");
    ownerMap = await buildUserMap();
    logger.info("user_map_refresh_success", {
      ownerCount: Object.keys(ownerMap).length,
    });
  } catch (error) {
    logger.error("user_map_refresh_failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}, 3600000);

const HUBSPOT_SEARCH_URL =
  "https://api.hubapi.com/crm/v3/objects/contacts/search";

app.post("/aircall/route", async (req, res) => {
  const { event, data } = req.body || {};

  if (!data) {
    logger.warn("aircall_payload_missing_data", { rawBody: req.body });
    return res.status(200).json({});
  }

  const callId = data.id || null;
  const callerNumber = data.raw_digits || null; // external caller number
  const aircallNumber = data.number || null; // your Aircall line
  const direction = data.direction || null;

  logger.info("incoming_call", {
    event,
    callId,
    callerNumber,
    aircallNumber,
    direction,
  });

  // Only handle newly created inbound calls; everything else falls back
  if (event !== "call.created" || direction !== "inbound") {
    logger.info("event_or_direction_not_handled", {
      event,
      direction,
      callId,
    });
    return res.status(200).json({});
  }

  if (!callerNumber) {
    logger.warn("caller_number_missing", {
      callId,
      aircallNumber,
    });
    return res.status(200).json({});
  }

  logger.info("hubspot_search_start", {
    callId,
    callerNumber,
  });

  try {
    const hubspotResponse = await axios.post(
      HUBSPOT_SEARCH_URL,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "phone",
                operator: "CONTAINS_TOKEN",
                value: callerNumber,
              },
            ],
          },
        ],
        properties: ["hubspot_owner_id"],
        limit: 1,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const results = hubspotResponse.data.results || [];

    logger.info("hubspot_search_complete", {
      callId,
      callerNumber,
      resultCount: results.length,
    });

    if (results.length === 0) {
      logger.info("hubspot_contact_not_found_for_number", {
        callId,
        callerNumber,
      });
      return res.status(200).json({});
    }

    const contact = results[0];
    const hubspotContactId = contact.id;
    const hubspotOwnerId = contact.properties?.hubspot_owner_id || null;

    if (!hubspotOwnerId) {
      logger.info("hubspot_contact_has_no_owner", {
        callId,
        callerNumber,
        hubspotContactId,
      });
      return res.status(200).json({});
    }

    const aircallUserId = ownerMap[hubspotOwnerId];

    if (!aircallUserId) {
      logger.warn("hubspot_owner_not_mapped_to_aircall_user", {
        callId,
        callerNumber,
        hubspotContactId,
        hubspotOwnerId,
      });
      return res.status(200).json({});
    }

    logger.info("call_routing_success", {
      callId,
      callerNumber,
      hubspotContactId,
      hubspotOwnerId,
      aircallUserId: parseInt(aircallUserId, 10),
    });

    return res.status(200).json({
      target_type: "user",
      target_id: parseInt(aircallUserId, 10),
    });
  } catch (error) {
    logger.error("call_routing_exception", {
      callId,
      callerNumber,
      error: error.message,
      stack: error.stack,
      hubspotStatus: error.response?.status,
      hubspotResponse: error.response?.data,
    });

    return res.status(200).json({});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info("server_listening", { port: PORT });
});

module.exports = app;
