const VoiceResponse = require("twilio").twiml.VoiceResponse; 
const getIvrSettings = require("../model/IvrSettings");
const { SaveCdrReport, UpdateCdrReport } = require("../model/cdrReport");
const sendMessage = require("../model/sendMessage");

const DEFAULT_FORWARD_INTERVAL_TIME_SEC = 1800;
const IVR_INPUT_HANDLER_ENDPOINT = "/api/v1/twilio/voice/ivr";
const IVR_HANDLER_ENDPOINT = "/api/v1/twilio/voice";
const callerLastAction = {};
const originalCallerNumbers = {}; // Store original caller numbers

const bypassForwardFlag = {};  // Track calls that bypass IVR

async function handleTwilioVoice(req, res) {
  const callerNumber = req.body.From;
  const callertoNumber = req.body.To;
  const company_id = req.query.company_id;
  const callId = req.body.CallSid;

  if (!originalCallerNumbers[callId]) {
    originalCallerNumbers[callId] = callerNumber;
  }

  const actionKey = `${callerNumber}_${callertoNumber}`;
  const currentTime = Date.now();
  const calledNumber = req.body.Called;

  const bosydata = req.body;
  console.log("bosydara",bosydata);

  const lastAction = callerLastAction[actionKey] || {};
  const twiml = new VoiceResponse(); 

  let [ivrConfigError, ivrConfig] = await getIvrSettings({ phoneNumber: calledNumber });

  if (!ivrConfig) {
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }

  let forwardConfig = ivrConfig["forward"];
  let lastIvrOptions = forwardConfig?.["last_ivr_options"] || [];

  const conditionsone =
  lastAction &&
  currentTime - lastAction.timestamp <
    (forwardConfig?.["forward_interval_time_sec"] ||
      DEFAULT_FORWARD_INTERVAL_TIME_SEC) *
      1000 &&
  lastIvrOptions.includes(lastAction.action && `ivr_${lastAction.action}`);
  
const conditionstwo =
  lastAction &&
  currentTime - lastAction.timestamp <
    (forwardConfig?.["forward_interval_time_sec"] ||
      DEFAULT_FORWARD_INTERVAL_TIME_SEC) *
      1000 &&
  lastAction.action === "forward";

  // If bypassing, directly dial the forward number without looping IVR
  if ((conditionsone || conditionstwo)) {
    // console.log("Bypassing IVR, directly connecting to forward number.");
    
    // // Directly forward the call
    // const forwardNumber = ivrConfig["forward_number"][0];
  
    // const dial = twiml.dial({ callerId: originalCallerNumbers[callId]});
    // dial.number(forwardNumber);
    

    // // Respond and end the request
    // res.writeHead(200, { "Content-Type": "text/xml" });
    // res.end(twiml.toString());
    // return;

    console.log("Conditions met. Stopping further execution.");
    // End the HTTP response and halt further processing
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(); // Stop the function and respond with an empty TwiML
    return; // Ensure no further logic is executed
  }

  // Regular IVR flow here (when not bypassing)
  const { promptContent, voice: welcomeMessageUrlsquare } = ivrConfig["ivr_prompt"];
  const gatherActionUrlsquare = IVR_INPUT_HANDLER_ENDPOINT;
  const gather = twiml.gather({ numDigits: 1, action: gatherActionUrlsquare });

  if (welcomeMessageUrlsquare) {
    gather.play(welcomeMessageUrlsquare);
  } else if (promptContent) {
    gather.say({ voice: 'woman' }, promptContent);
  } else {
    twiml.say({ voice: 'woman' }, "Sorry, something went wrong!");
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());

  // Save CDR report
  let reportStatus = await SaveCdrReport(req.body);
  console.log("reportstaus",reportStatus);
  return;
}

async function handleTwilioVoiceInputs(req, res) {
  const userInput = req.body.Digits;
  const calledNumber = req.body.Called;
  const twiml = new VoiceResponse(); 
  const callerNumber = req.body.From;
  const callId = req.body.CallSid; 
  const originalCallerNumber = originalCallerNumbers[callId]; 

  const actionKey = `${callerNumber}_${calledNumber}`;
  if (!callerLastAction[actionKey]) {
    callerLastAction[actionKey] = {};
  }

  callerLastAction[actionKey] = { action: userInput, timestamp: Date.now() };
  let [ivrConfigError, ivrConfig] = await getIvrSettings({ phoneNumber: calledNumber });
  console.log("configjson",ivrConfig);
  if (!ivrConfig) {
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }

  if (!userInput) {
    twiml.say({ voice: 'woman' }, "You didn't press any key. Goodbye!");
    twiml.gather({ numDigits: 1, action: IVR_INPUT_HANDLER_ENDPOINT });
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }
  
  let currentIVRKey = `ivr_${userInput}`;
  if (currentIVRKey === "ivr_0") {
    const { promptContent, voice: welcomeMessageUrlsquare } = ivrConfig["ivr_prompt"];
    const gather = twiml.gather({ numDigits: 1 });
    if (welcomeMessageUrlsquare) {
      gather.play(welcomeMessageUrlsquare);
    } else if (promptContent) {
      gather.say({ voice: 'woman' }, promptContent);
    } else {
      twiml.say({ voice: 'woman' }, "Welcome! Please press a key to continue.");
    }
    twiml.redirect(IVR_INPUT_HANDLER_ENDPOINT);
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }

  let {
    available_ivr_options,
    invalid,
    ivr_invalid,
    thankyouMessage,
    ivr_thankyou,
  } = ivrConfig;
  invalid ||= ivr_invalid;
  thankyouMessage ||= ivr_thankyou;
  let isValidIVR = available_ivr_options.includes(currentIVRKey);
  
  if (!isValidIVR) {
    if (invalid && invalid.voice) {
      const gatherActionUrlsquare = IVR_INPUT_HANDLER_ENDPOINT;
      const gather = twiml.gather({ numDigits: 1, action: gatherActionUrlsquare });
      gather.play(invalid.voice);
    } else if (invalid && invalid.promptContent) {
      twiml.say({ voice: 'woman' }, invalid.promptContent);
    }
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }

  let currentIVRoptions = ivrConfig["ivr_options"][currentIVRKey];

  if (!currentIVRoptions) {
    twiml.say({ voice: 'woman' }, "Sorry, something went wrong!");
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }
  
  let {
    voice,
    promptContent,
    message,
    type = "call",
    forward,
    forward1,
    mainMenu,
  } = currentIVRoptions;

  if (voice && !mainMenu && !forward) {
    twiml.play(voice);
  }

  if (mainMenu) {
    const gather = twiml.gather({ numDigits: 1 });
    if (voice) {
      gather.play(voice);
    }
    twiml.redirect(IVR_INPUT_HANDLER_ENDPOINT);
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
    return;
  }

  if (message) {
    if (type === "call") {
      type = "sms";
    }
    let messageStatus = await sendMessage({ to: originalCallerNumber, message });
    console.log("originalnumberdis",originalCallerNumber)
  }
  if (forward) {
    if (voice) {
      twiml.play(voice);
    } else if (promptContent) {
      twiml.say({ voice: 'woman' }, promptContent);
    }
  
    // Log the originalCallerNumber before dialing
    console.log("Dialing with callerId:", originalCallerNumber);
  
    if (ivrConfig["forward_number"].length > 1) {
      const dialWithTimeout = twiml.dial({ callerId: originalCallerNumber, timeout: 6 });
      console.log("Dialing forward_number[0]:", ivrConfig["forward_number"][0]); // Log forward number 0
      dialWithTimeout.number(ivrConfig["forward_number"][0]);
  
      const dialAfterTimeout = twiml.dial({ callerId: originalCallerNumber });
      console.log("Dialing forward_number[1]:", ivrConfig["forward_number"][1]); // Log forward number 1
      dialAfterTimeout.number({ url: IVR_HANDLER_ENDPOINT }, ivrConfig["forward_number"][1]);
    } else {
      const dial = twiml.dial({ callerId: originalCallerNumber });
      console.log("Dialing single forward_number:", ivrConfig["forward_number"][0]); // Log the single forward number
      dial.number(ivrConfig["forward_number"][0]);
    }
  
    // Log the caller's last action to verify the update
    callerLastAction[actionKey] = {
      action: "forward",
      timestamp: Date.now(),
    };
    console.log("Updated callerLastAction:", callerLastAction[actionKey]);
  }


 else if (forward1) {
    if (ivrConfig["forward_number1"].length > 1) {
      const dialWithTimeout = twiml.dial({ callerId: originalCallerNumber, timeout: 6 });
      dialWithTimeout.number(ivrConfig["forward_number1"][0]);
      const dialAfterTimeout = twiml.dial({ callerId: originalCallerNumber });
      dialAfterTimeout.number({ url: IVR_HANDLER_ENDPOINT }, ivrConfig["forward_number1"][1]);
    } else {
      const dial = twiml.dial({ callerId: originalCallerNumber });
      dial.number(ivrConfig["forward_number1"][0]);
    }
    callerLastAction[actionKey] = {
      action: "forward1",
      timestamp: Date.now(),
    };
  } else if (thankyouMessage && thankyouMessage.voice) {
    twiml.play(thankyouMessage.voice);
  } else if (thankyouMessage && thankyouMessage.promptContent) {
    twiml.say({ voice: 'woman' }, thankyouMessage.promptContent);
  }
  
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
  req.body.CallType = type;
  let reportStatus = await UpdateCdrReport(req.body);
  console.log(reportStatus);
  return;
}

function getTwilioVoice(req, res) {
  res.json({ status: "success", message: "Hi! from server." });
}

module.exports = {
  getTwilioVoice,
  handleTwilioVoice,
  handleTwilioVoiceInputs,
};
