-- Synthetic records only. No provider credentials, sends, purchases, or workers.
INSERT INTO organization (id,name,slug,"createdAt") VALUES ('restore-org','Restore fixture','restore-fixture',now());
INSERT INTO "Inbox" (id,"organizationId",name,address) VALUES ('restore-inbox','restore-org','Restore','restore@example.invalid');
INSERT INTO "EmailMessage" (id,"organizationId","inboxId","providerId","threadId",direction,status,"from","to",subject,text,"updatedAt")
VALUES ('restore-email','restore-org','restore-inbox','restore-email-provider','restore-thread','inbound','received','sender@example.invalid',ARRAY['restore@example.invalid'],'Unicode ✓','Untrusted fixture content',now());
INSERT INTO "Attachment" (id,"messageId","providerId",filename,"contentType",size,"objectKey")
VALUES ('restore-attachment','restore-email','restore-file','example.txt','text/plain',12,'synthetic/object-key');
INSERT INTO "PhoneNumber" (id,"organizationId","phoneNumber","messagingProfileId",status,"updatedAt")
VALUES ('restore-number','restore-org','+12025550109','restore-profile','active',now());
INSERT INTO "SmsMessage" (id,"organizationId","phoneNumberId","providerId",direction,status,"from","to",text,segments,"costAmount","costCurrency","updatedAt")
VALUES ('restore-sms','restore-org','restore-number','restore-sms-provider','inbound','received','+12025550108','+12025550109','Fixture',2,0.0040000001,'USD',now());
INSERT INTO "Operation" (id,"organizationId","principalId",key,route,"requestHash",status,result,"updatedAt")
VALUES ('restore-operation','restore-org','restore-principal','restore-idempotency','sms.send','synthetic-hash','unknown','{"reason":"fixture"}',now());
INSERT INTO "ProviderEvent" (id,provider,type,payload,status,attempts)
VALUES ('restore-provider-event','telnyx','message.received','{"fixture":true}','pending',1);
INSERT INTO "WebhookEndpoint" (id,"organizationId",name,url,"eventTypes","secretCiphertext","updatedAt")
VALUES ('restore-endpoint','restore-org','Disabled fixture','https://example.invalid/callback',ARRAY['sms.received'],'synthetic-opaque-ciphertext',now());
INSERT INTO "ApiRequestBucket" ("organizationId",bucket,"window",count)
VALUES ('restore-org','workspace',12345,17);
