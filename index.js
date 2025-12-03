require("dotenv").config();
const express = require("express");
const axios = require("axios");
const buildUserMap = require("./user_sync");
const logger = require("./logger");

const app = express();
app.use(express.json());

let ownerMap = {};

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
  const { callerNumber, callUUID } = req.body || {};

  logger.info("incoming_call", {
    callerNumber,
    callUUID,
    rawBody: req.body,
  });

  if (!callerNumber) {
    logger.warn("caller_number_missing_in_payload", {
      callUUID,
      rawBody: req.body,
    });
    return res.status(200).json({});
  }

  logger.info("hubspot_search_start", {
    callerNumber,
    callUUID,
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
      callerNumber,
      callUUID,
      resultCount: results.length,
    });

    if (results.length === 0) {
      logger.info("hubspot_contact_not_found_for_number", {
        callerNumber,
        callUUID,
      });
      return res.status(200).json({});
    }

    const contact = results[0];
    const hubspotContactId = contact.id;
    const hubspotOwnerId = contact.properties?.hubspot_owner_id || null;

    if (!hubspotOwnerId) {
      logger.info("hubspot_contact_has_no_owner", {
        callerNumber,
        callUUID,
        hubspotContactId,
      });
      return res.status(200).json({});
    }

    const aircallUserId = ownerMap[hubspotOwnerId];

    if (!aircallUserId) {
      logger.warn("hubspot_owner_not_mapped_to_aircall_user", {
        callerNumber,
        callUUID,
        hubspotContactId,
        hubspotOwnerId,
      });
      return res.status(200).json({});
    }

    const targetId = parseInt(aircallUserId, 10);

    logger.info("call_routing_success", {
      callerNumber,
      callUUID,
      hubspotContactId,
      hubspotOwnerId,
      aircallUserId: targetId,
    });

    return res.status(200).json({
      data: {
        target_type: "user",
        target_id: targetId,
      },
    });
  } catch (error) {
    logger.error("call_routing_exception", {
      callerNumber,
      callUUID,
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
