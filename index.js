require("dotenv").config();
const express = require("express");
const axios = require("axios");
const buildUserMap = require("./user_sync");
const logger = require("./logger");

const app = express();
app.use(express.json());

let ownerMap = {};
let lastSync = 0;
const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const HUBSPOT_SEARCH_URL =
  "https://api.hubapi.com/crm/v3/objects/contacts/search";

async function getOwnerMap() {
  const now = Date.now();
  const needsSync =
    !lastSync ||
    now - lastSync > SYNC_INTERVAL_MS ||
    Object.keys(ownerMap).length === 0;

  if (needsSync) {
    logger.info("user_map_sync_triggered");
    ownerMap = await buildUserMap();
    lastSync = now;
  }

  return ownerMap;
}

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
        timeout: 8000,
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

    const currentOwnerMap = await getOwnerMap();
    const aircallUserId = currentOwnerMap[hubspotOwnerId];

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
      message: error.message,
      code: error.code,
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
