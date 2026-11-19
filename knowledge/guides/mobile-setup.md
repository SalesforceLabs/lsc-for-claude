# Life Sciences Cloud (LSC) Mobile Setup and Configuration Guide

*Converted from PDF documentation*

---

SE Life Sciences Commercial
Engagement
Mobile Setup & Config




Started July 2025
Last updated Jan 2026
                           SE LSC Mobile Setup and Configuration Guide

This document is based on adhoc configuration notes and socialized knowledge. This is not official
documentation steps or setup.


Key Resources
​
(New) LSC4CD SE Learning Resources: Canvas



Known Issues
Please refer “What to Know About the LSDO!” Canvas: Known Issues (LSC4CE)



Custom Mobile Apps on LSC Mobile
You can now create and download custom Lightning Apps to LSC Mobile on the iPad.

Create your Lightning App following same guidelines as updating the provided Life Sciences Commercial App.​
​
To assign your custom Lightning App to a Profile:​
​
Admin Console → Mobile → Profile Based App Settings
    ●​ Apply Settings To = Profile
    ●​ Select Profile = profile you want to assign to the app
    ●​ Mobile App = name of your custom Lightning App
    ●​ Press Save




                                                                                        ​
​


                                                                                                          1
                             SE LSC Mobile Setup and Configuration Guide

Custom Lightning Web Components
You can add custom lightning web components only to the following areas of LSC Mobile:
   ●​ Home Screen
   ●​ Record Page
   ●​ As a Quick Action

You can also only have 1 LWC on a lightning web page.

The prefix for the LWC must start with “lscMobileInline.”

See Lifesciences Cloud Apps Setup Guide: GDoc

Older version: Link




Home Page - Utterances

These are provided by LWCs = homeAnnouncements and IsAgentforceWelcome. This is already setup on
the lightning page = Home Page LSC Default​
​
These are no longer custom LWC. They are provided as part of the lsc4ce managed package.

To modify the utterances:
   ●​ Edit Page on the Home Page LSC Default
   ●​ Click the whitespace area above the Home Announcements LWC
   ●​ You should see IsAgnetforceWelcome displayed in right panel.
   ●​ Change the utterances you would like to see.
   ●​ These are real sentences that will be fed to the Copilot Agent




Home Page - Announcements


                                                                                               2
                           SE LSC Mobile Setup and Configuration Guide

Announcements are App Alert records. If they don’t display - the Effective Date needs to be changed to the
current date.

STEP 1 - Update Alert Effective Date

   ●​ Go to App Alerts via App Launcher

   ●​ Select App Alert with Type =                                                          Announcement




   ●​ Reset Effective Date to current date (content expires after 7 days).

STEP 2 - To change or Remove Expiration Requirement

   ●​ Go to: Admin Console -> Mobile -> Entities

   ●​ Search for AppAlert and click edit:




                                                                                                             3
                            SE LSC Mobile Setup and Configuration Guide




   ●​ On Edit page, scroll down to Where Soql:




Either remove the clause or change the expiration from 7 days to something further out.
                                                                                          4
                            SE LSC Mobile Setup and Configuration Guide




App Alert Visibility

App Alert Visibility is controlled by Profile/Permission Sets + App Alert Territory value.​
​
To control visibility Announcements (and Notifications and Guided Actions) by user/territory:

   ●​ Make sure user's territory is setup as App Alert Territory record.
        ○​ Territory Hierarchy visibility does not pertain. You must add any/all user territories in order for
            the user to see the App Alert.
   ●​ Make sure org wide sharing rule = Private - this is preset in LSDO
   ●​ Make sure Profile/Permissions for the User have View all Records unchecked - this is preset in LSDO

Other issues that may impact
   ●​ Incorrect JSON - copy and paste into Gemini or ChatGPT to check
   ●​ User has already seen/responded to the App Alert - delete the App Alert User Response record.



Activity Plans

Overview of Activity Plans, What they Are:   Link

LSC Activity Plans Help Documentation - Setup of Activity Plans
                                                                                                                 5
                             SE LSC Mobile Setup and Configuration Guide


DBSchema Setup for Activity Plans to work on LSC Mobile - Add:

   ●​   Activity Plan Territory (type = data)
   ●​   Provider Activity Goal (type = data)
   ●​   Provider Activity Goal Measure (type = data)
   ●​   Provider Activity Goal Measure Product (type = data)
   ●​   Provider Activity Measure Type ( type = configuration )




Content/Presentations
Using the content on the iPad — to move the content to the next slide - “short swipe” – only 1 inch
Content Setup Doc

How to create HTML5 Content Zip files: Video

How to load the content -
https://docs.google.com/document/d/1V7McOBoZ3pybmMzuVx4lA6rgH-jYovfojtazXcx-sOg/edit?usp=sharing


Actual content to load:
https://drive.google.com/drive/folders/18CsCFFP6uoxNY6UiYHCt3vBnzy1q7Fk_
OCE Documentation is inline with LSC experience
Difference between Presentation and Pages
Admin Screen

Setup Attachment support for PresentationPage:
   ●​ Go to Admin Console > Mobile > Entities.
   ●​ Search for PresentationPage
   ●​ Use Dropdown arrow on far right to select Edit




   ●​ Go to Attachments Support field
   ●​ Select Background



                                                                                                      6
                            SE LSC Mobile Setup and Configuration Guide




Both Background and Cache options work:
   ●​ Background - it will sync in the background, outside of the data sync process.
   ●​ Cached - the first time you use that object, you bring the attachment down.

Background is recommended in case the file is very large, e.g. 1 GB file which may lock the UI.




Generating Mobile Cache
For any modifications to page layouts and objects, a new mobile needs to be created and downloaded to the
iPad (via Synch). Data changes (new records, modifications, etc) do not require a new cache.


To deploy configuration changes to Mobile, you must generate a new mobile cache.
    ●​ Life Science Commercial app → Admin Console
    ●​ Mobile
    ●​ Select Metadata Cache
    ●​ Press Create New Cache button
    ●​ Refresh the browser to see updated status
           ○​ You can also track status in Setup →Apex Jobs

Cache status must be active in order for it to synch to the Mobile app. ​


Generating Cache in a new LSDO Org
  ●​ Generate cache for all profiles – skip verification - unchecked - this should take less than 10 min
  ●​ After initial cache is generated, generate cache for the profiles/personas you are using – make sure
      skip verification is NOT checked
          ○​ You should start with a verified cache on all personas - verified cache can take 20-40 min to run




                                                                                                             7
                             SE LSC Mobile Setup and Configuration Guide




Check the Cache on iPad LSC Mobile App

On the mobile, click the circle with your user's initials (upper right corner) to access the Profile page. Then
press Show Database. Make sure that the metadata version – will start with LSMMR - matches the latest
active metadata cache version online at Admin Console → Mobile.

If it doesn't match, that means your mobile app is not working with the latest version of the active metadata
cache that you've generated. ​
​
Run the synch from the mobile to try and download it again. As a last resort delete the app and re-install.




                                                                                                                  8
                             SE LSC Mobile Setup and Configuration Guide




Cache FYI
   ●​ Running caches at night US timezone will take longer when validating
          ○​ Many customers run nightly batch jobs. These jobs are prioritized more than Apex test suites
              which are used for mobile cache validation, therefore validation will take much longer
          ○​ If the cache is taking a long time to run - just let it run
          ○​ There also may be occasional heavy load of Apex jobs during the day
   ●​ Validation tests are focused on DBSchema record soql queries, merge fields and a few other checks
          ○​ So if you are doing standard config updates -- you can probably check the "skip validation"
              box and get cache faster.
          ○​ However, it is important to generate a validated cache on a regular basis and as a "final check"
              for your demo.
   ●​ You can track Validation Testing in Setup -->Custom Code -->Application Test Execution & Application
      Test History
          ○​ This should give you an idea if there is something that is causing a problem (or if it's just slow
              because it's competing with other jobs).
          ○​ This is a great video by Peter Yeung -- make sure you carve out time to watch it. Metadata
              Admin Release enablement 258: Link



Troubleshooting Cache Issues

Cache is Inactive
If the Status is inactive check the LSMMR record to see the cache detail record.
     ●​ Look at the information in the Error Log field to see if there is any details on what is causing the issue.

                                                                                                                      9
                             SE LSC Mobile Setup and Configuration Guide

   ●​ If the Error Log field is blank or has error message similar to “"message":"Unknown error for
      parentMetadataRecordId 1KAKX0000008OYH4A2: Please retry the request." —-- Delete the LSMMR record and
      re-run the cache.




Cache Error - Storage Limit Exceeded ​


This is an error we are seeing on many LSDO.​       There is a limit that is hit - even though the Data Storage in
the org is low vs. limits. ​  We are investigating with product management and dev/engineering.


In the interim - follow the steps in this video to quickly clear up your storage: How to Delete Records



Configuration Error (Mobile) - 400/403
This is usually a missing permission issue on profile, DBSchema, or missing permission set

   1.​ Make sure following permission are set/”checked” on the user profile:
         ○​ API Enabled
   2.​ Make sure your user has the following permissions:
         ○​ Permission Set License Assignment
                 ■​ Health Cloud Starter
                 ■​ Life science Commercial
         ○​ Permission Set Assignments
                 ■​ Health Cloud Starter
                 ■​ Life Science Core
                 ■​ Industries Visit
                 ■​ Life Sciences permission set for your LSC4CE persona – if there is not - use Life
                     Sciences Field Sales Representative
                 ■​ LSDO-All Life Science Commercial Users
                 ■​ There may be other permission sets to add, other LSDO permission sets for your
                     persona

                                                                                                               10
                             SE LSC Mobile Setup and Configuration Guide

   3.​ Login as the User - see if there are any error messages that appear in the browser to indicate the
       object/permissions that are missing
           ○​ You should have logged in to browser as the persona before logging into mobile to setup the
               User Additional Information record fro the persona
           ○​ To see any permission errors – login to browser after trying to login on mobile
   4.​ Based on error messages - Update Profile Object Permissions and also check/update the associated
       object DBSchema record




Data Not Displaying on Mobile
Data Not Displaying
   1.​ Is it displaying when logged in on browser
            ○​ If no
                    ■​ Check to make sure the proper visibility is set on the record - e.g. Owner, Territory
                        (Territory may be set as Related record)
                    ■​ Check Profile to make sure has proper access to object and/or record type for the object
                    ■​ Recommend do not to make settings on objects = View All Records. The LSDO has all
                        of the SDO data - therefore you could end up with a lot of records that don’t fit your
                        persona, making the UX look “noisy” and not related to Life Science Industry.
            ○​ If yes - see below
   2.​ Check the Database on Mobile - Is the record downloaded
            ○​ If no - check DbSchema record to make sure the profile has access
            ○​ If yes - check the record to see if it contains a field with JSON
                    ■​ Check the JSON (use Chat GPT or Gemini) to make sure it is configured properly this
                        will keep the record from displaying)
                             1.​ If JSON correct, compare to working records
                             2.​ Provider Account Territory Summary - JSON must start with “keyinfo” - this is only
                                 for Provider Account Territory Summary
                    ■​ If the JSON isn’t configured properly the record
            ○​ If no - post to #mastering-lsc4ce-for-solution-engineers



Functionality Not Displaying on Mobile

Custom LWC
   1.​ Make sure your LWC start with lscMobileInline. See Custom LWC section
   2.​ Is there more than one custom LWC component on the Lightning Page?
            ○​ If yes, the component won’t display — can currently only have 1 Apex Class per Lightning Page
               on Mobile
   3.​ Apex Class - Check permission set visibility
            ○​ Make sure the Apex Class is added to LSDO-All Life Science Commercial Users (or if for a
               specific persona - the LSDO permission set for that persona)
            ○​ Make sure your user is added to the permission set


                                                                                                                11
                            SE LSC Mobile Setup and Configuration Guide




Object Metadata Cache Config (DBSchema Records)
The Object Metadata Cache Configuration controls the actual data that is synched to the LSC Mobile app.
Setup as “DbSchema” records.

There are 2 types of Cache Configuration records
   ●​ Data - specifies the data that is synched to the LSC Mobile - specify object, profile(s), and any data
       filters (SOQL queries)
            ○​ If you setup a SOQL Filter Condition --- you must encase the statement with parenthesis ()
                    ■​ e.g. RecordType.DeveloperName = 'LSDO_Medical_Inquiry' --- should be
                       (RecordType.DeveloperName = 'LSDO_Medical_Inquiry')
                    ■​ If you do not do this, it could cause a SQLite or other error (edited)

   ●​ Configuration - information that is not kept in sObject that needs to be synched to LSC Mobile.
      Configuration records need to be made for the following:
         ○​ Ratings: PrvdClassificationLayout, PrvdClsfnLayoutAttribute, PrvdClsfnAttrDefinition
         ○​ Activity Plan: ProviderActivityMeasureType
         ○​ Data Change Request: LifeSciDataChangeDef

Initially there were other configuration records — these are no longer needed.



Data Setup

Languages

English & French currently enabled




                                                                                                               12
                            SE LSC Mobile Setup and Configuration Guide




Custom LWC – LSC Apps (Account Page - Insights)
LSC Apps are framework for creating and deploying LWC to LSC Mobile app. Example of this is the Insights
tab on the Account Page

In order for the LSC Apps to display:
    -​ You must have the associated Quick Actions added to the object
    -​ The LWC must start with lscMobileInline
    -​ You can only have one LSC app on a page.

See Here for more information: LSC Apps Guide

Old - Original Document

To setup Accounts - Insights:
Deploy the LWC along with the static resource for chart.js. Add LWC to Account Lightning Record Page layout
on the Dashboard so it shows up when the Account page is loaded.

Scroll down for information about the Insight information/metrics




                                                                                                         13
                              SE LSC Mobile Setup and Configuration Guide




Tiles:

 ●​ Account view / edit tile. This illustrates that the customer can create their own LWC tile.
 ●​ Tweets... I know not all HCP's tweet but for KOL data sets, seems to be a big selling point
 ●​ AgentForce Insights: they can be somewhere native, or it can be put here as a LSC app.
 ●​ Competitive Analysis is a chart. Want to de-emphasize, but also show it's possible to do charts in LSC apps.
 ●​ Referral Network: which can be sourced from claims data. It is important to show how influential the HCP is. Could
    be a primary care doc that refers to a specialist. So if you're a specialty rep, you want to know which HCP was
    upstream to drive more referrals.
 ●​ Digital Engagement just shows digital savviness. Lots of vendors sell this type of info.
 ●​ Conference Highlights would be where events the HCP is scheduled to show up at. Customers have said this is how
    some reps get access to the no access docs.
 ●​ Scientific publication: you want to know what the HCP has been authoring, co-authoring, reviewing, etc.

The LWC pulls the account name into the tiles, so the tiles will look nice with any Account chosen.




                                                                                                                   14
                            SE LSC Mobile Setup and Configuration Guide

Stories- Enable
Stories is a custom pre-GA capability that was hard coded directly into the LSC Mobile Demo version.   It will
not be GA until late 2026. For GA stories is demonstrated via Field Sales Rep Agent action.i

Too setup - Enable Demo Mode on the iOS LSC Dev application.


 On your iPad - go to Settings → Apps

 LSC Dev




 Press Developer Settings




 In Demo Mode - enter 352qtc




                                                                                                             15
                             SE LSC Mobile Setup and Configuration Guide


 The next time you launch the LSC Dev app on your
 iPad you should see the Stories on the home page.
 (Icon bottom left)




Smart Search (Pre GA0
Smart Search is automatically enabled when Stories is enabled of Mobile Demo 2.0 versions.

Similar to Stories - this was a “hard coded” “future” capability that included direct access to Agentforce.




Global Search (Pre GA)

For 258 GA release - the objects supported in Global Search on iPad are hard-coded to the following six:
Account, Healthcare Provider, Visit, Provider Visit, Presentation, and Inquiry.

Other standard or custom objects brought down to mobile — whether or not exposed as navigation tabs — are
not currently supported. (For example, Cases would not appear.)

Support for other objects is on the roadmap.




                                                                                                              16
                           SE LSC Mobile Setup and Configuration Guide

Consent Setup
Based on the NYWT demo setups, here is a list of data and configurations created.



Create Subscriptions and related object data

Communication Subscriptions
                        Name                                               Attributes

 Rheumatology Clinical Research                        United States

 Oncuvia                                               United States

 Immunexis                                             United States

 Immunexis France                                      France




                                                                                        17
                   SE LSC Mobile Setup and Configuration Guide

Data Use Purpose




Communication Subscription Channel Types




                                                                 18
                                 SE LSC Mobile Setup and Configuration Guide

Engagement Channel Types




Compliance Statement Definitions - Terms & Conditions




Terms & Conditions HTML:
<!DOCTYPE html>
<html>
  <head>
    <title>Terms and Conditions</title>
  </head>
  <body>
    <style>
    p {
        font-family: Verdana;
        font-size: 20px;
        color: black;

                                                                               19
                                 SE LSC Mobile Setup and Configuration Guide

        }
        </style>
    <p><b>By consenting to receive communications from Makana Pharma</b>, the healthcare professional agrees to the following terms
and conditions:</p>
    &nbsp;
    <p style=text-indent:40px;>1. The healthcare professional acknowledges that the information provided by Makana Pharma is for
educational and informational purposes only and should not be considered medical advice.</p>
​          &nbsp;
    <p style=text-indent:40px;>2. The healthcare professional agrees to use the information provided by Makana Pharma in a
responsible and ethical manner, taking into account the best interests of their patients.</p>
​          &nbsp;
    <p style=text-indent:40px;>3. The healthcare professional understands that any recommendations or suggestions made by Makana
Pharma are based on the available scientific evidence at the time of publication and may be subject to change.</p>
​          &nbsp;
    <p style=text-indent:40px;>4. The healthcare professional agrees to comply with all relevant laws, regulations, and industry
guidelines when using or sharing information provided by Makana Pharma.</p>
​          &nbsp;
    <p style=text-indent:40px;>5. The healthcare professional acknowledges that Makana Pharma may collect and use their personal
information for the purpose of communicating with them and providing relevant information.</p>
​          &nbsp;
    <p style=text-indent:40px;>6. The healthcare professional agrees to keep their login credentials and any other access information
provided by Makana Pharma confidential and not share them with unauthorized individuals.</p>
​          &nbsp;
    <p style=text-indent:40px;>7. The healthcare professional understands that they have the right to unsubscribe from communications
from Makana Pharma at any time by following the instructions provided in the communication.</p>
​          &nbsp;
    <p><b>Data Privacy</b> - Makana policies concerning the use of your personal information are set forth in the Online Privacy
Statement and incorporated by reference herein. By using the services provided by our sales reps, you agree to waive and release
Makana from any claim or liability in connection with the collection, use, or disclosure of information consistent with Makana Data
Privacy Statement.
    &nbsp;
    <p><b>By acknowledging these terms and conditions, the healthcare professional consents to receive communications from Makana
Pharma and agrees to abide by the terms outlined above.</b></p>
  </body>
</html>




Mobile Config Settings

DbSchema entries for Mobile
Note: While creating DbScheme entities, please ensure that it is case sensitive and also not using “full object
names” but only using the sObject names.

As of Oct 2025 - Mostly only Data DBSchema records are needed.                      The only Configuration records that are
needed are for:​

    ●​ Ratings: PrvdClassificationLayout, PrvdClsfnLayoutAttribute, PrvdClsfnAttrDefinition
    ●​ Activity Plan: ProviderActivityMeasureType
    ●​ Data Change Request: LifeSciDataChangeDef


                                                                                                                                  20
                                     SE LSC Mobile Setup and Configuration Guide

        Existing DBSchema records can be copied from another org - see info LifeScienceConfig Deployment via VS
        Code
                ​



me                                      sObject                          Profiles                             Type
                                                                         Medical Sales Representative, System
Schema_CommSubscription                 CommSubscription                 Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_EngagementChannelType            EngagementChannelType            Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_CommSubscriptionChannelType      CommSubscriptionChannelType      Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_CommSubscriptionConsent          CommSubscriptionConsent          Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_CommSubConsentCmplSnpsht         CommSubConsentCmplSnpsht         Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_DigitalSignature                 DigitalSignature                 Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_DataUsePurpose                   DataUsePurpose                   Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_ComplianceStatementDef           ComplianceStatementDef           Administrator, Standard User         Data
                                                                         Medical Sales Representative, System
Schema_OptAdministration                LifeSciConfigRecord              Administrator, Standard User         Config




        State License Number Setup
        Values in the picklist should just be formula checkbox fields.




                                                                                                                       21
                    SE LSC Mobile Setup and Configuration Guide




State Distributor Setup




                                                                  22
                   SE LSC Mobile Setup and Configuration Guide




DEA Number Setup




                                                                 23
                           SE LSC Mobile Setup and Configuration Guide

Next Best Customer
This is a custom LWC component

NOTE: The user must have “View All Records” access to Territory Account Scores or the custom LWC on the
Home Page will show an error.

To create/edit the values:
    ●​ Go to Territory Account Scores in App Launcher
    ●​ Either Create New or Edit (if you want to change the information)
    ●​ Provide the data you want to see in the NBC record.
    ●​ -Ensure that the right Territory is selected for the account.
    ●​ Make record owner = user you want to see the record - this will automatically create the Share
       rule for the record OR
           ○​ Press Share button - make sure you share the record with the user (e.g. Evan, Murray, etc.)




Provider Summaries/Smart Summaries
This information comes from the Provider Account Territory Summary (PATS) object/records

In order for a user to see a Provider Summary - a PATS record must be created that is specific to the
Provider - User and Territory.

For customer, the PATS record would be generated by Agentforce or other customer business process.


                                                                                                            24
                           SE LSC Mobile Setup and Configuration Guide

The easiest way to do this is to clone an existing record - change the territory and user for your new user.

   1.​ As Sys Admin - App Launcher - search for Provider Account Territory Summaries
   2.​ Select record with JSON results similar to what is needed in your new record
   3.​ Clone the record - change the Account - Territory - User to fit your use case
   4.​ If you need to change the Key Information Summary (JSON) - recommended to use Gemini or other
       tool
            a.​ It is important that the JSON start with “keyinfo”
                ​




   5.​ View on Account Page to ensure it is rendering properly
          a.​ You will only see the Summary if you are logged in as the user - e.g. System Admin may not
              see it




                                                                                                           25
                              SE LSC Mobile Setup and Configuration Guide




Territory Models/Management
Can be used for building a territory, aligning field users to a territory as well as aligning accounts to a territory.
It might be a hack way to do it for Demos.

You have to assign users to a Territory - including the Admin user

    ●​ Go to Setup → Territory Models
    ●​ LSC Territory Model — press View Hierarchy Link
    ●​ Drill down on RD-Midwest 20A
    ●​ Assigned Users - Manage Users
            ○​ Add Admin User and Evan Casto
    ●​ Repeat above steps for RD - West - 20D




                                                                                                                     26
SE LSC Mobile Setup and Configuration Guide




                                              27
                           SE LSC Mobile Setup and Configuration Guide




Inquiries
Workflow Error on Inquiry Error Loading Data

Issue: In the SDB619 demo orgs there is a formula field on Case = Inq_IsCreatorOrResponde used to drive
the workflow values. This is setup to accommodate a customer's Customer Facing Colleague profile and
company nomenclature = e.g Respondor instead of Creator

Original Formula:
​
IF($Profile.Name = 'Customer Facing Colleague', 'Responder', IF($Profile.Name = 'Field Sales
Representative', 'Creator', ''))

                                                                                                    28
                             SE LSC Mobile Setup and Configuration Guide


Updated Formula: ​
​
IF($Profile.Name = 'Customer Facing Colleague', 'Responder', ‘Creator’)

Also set Field Security = Visible


Additional information from Frank C. on how to setup Inquiry Workflow and the fix.
   ●​ Inquiries can be controlled by LS Workflow (Admin Console --> Workflow Configuration)
   ●​ The current workflow config expects a value of "Creator" to be returned for the context user in order to
       create an Inquiry.
   ●​ Field = Inq_IsCreatorOrResponder – The formula being evaluated had to be adjusted:
            ●​ I added "System Administrator" to the formula so that it will work when testing as an admin
            ●​ I set the field-level accessibility for "Visible" to true for the CFC, FSR and Sys Admin profiles.

Additional Setup:
   ●​ Medical rep needs access to Cases object when setting up an Org
   ●​ Inquiries can currently only be created via the browser
           ○​ Case object is not in mobile app yet so Inquires can not be created in mobile (fix expected in
               July)




Tableau Next Setup (User)

Setup a tab via the Admin Console -> Mobile -> UI




The as the user, select metrics to follow from the Tableau Next app in Salesforce

                                                                                                                29
SE LSC Mobile Setup and Configuration Guide




                                              30
                            SE LSC Mobile Setup and Configuration Guide




Quick and Custom Actions

Configuration Guide for Quick and Custom Actions - document here

This covers Utterances (canned prompts) and quick actions available via icon in lower righthand corner of
mobile app.




                                                                                                            31
SE LSC Mobile Setup and Configuration Guide




                                              32
                           SE LSC Mobile Setup and Configuration Guide

Localize for Other Languages

See: QRG: How to localize LSC App to demo for other languages




Product Detail Messages on Visit Record
Territory Account Product Message Scores
Product Guidance




Setup Email Templates

Follow instructions in document below

LSC Email Setup: GDoc




                                                                         33
                             SE LSC Mobile Setup and Configuration Guide

Visit Page Layout

Visit sidebar menus:
Recommendations menu is hard-coded (currently) and displayed if data for the account exist.
Other menus will come from Visit page layout for GA, but for NYWT demo org version, Presentations,
Samples and Attendees come from Visit page layout and others come from Provider Visit Page layout.
Presentation Forum (Presentations), Product Disbursement (Samples) and Attendees (Child Visit) related
list may need to be added to the Visit Layout. If you add them to the Visit Layout or assign NYWT Visit
Layout where Presentations and Samples are added to the rep's profile, they should be displayed in the
Visit page.




Sample Management
(From PM Sample Inventory Data Setup Steps)

General Guidance:

Ensure all fields are added to the Page Layout for all relevant entities required for
Inventory Setup

Entities Required for Inventory Setup:

   ●​ Product2 – Defines the product.
   ●​ LS Marketable Product- Define the data for the Sample Product.
   ●​ Users – Identifies owners and stakeholders.
   ●​ Location – Specifies where the product is stored
         ○​ Address- User Defines----
   ●​ Production Batch – Stores batch-related details.
   ●​ Product Item – Manages inventory, location, and ownership.
   ●​ Product Batch Item – Tracks batch items in inventory.

Entities for Recording Transaction & Operations: (These entities come into action when
Users start operating on inventory)

   ●​   Product Disbursement – Gets created when the product is disbursed during a visit
   ●​   Inventory Operations – Gets created for any inventory transaction
   ●​   Product Transfer – Gets created with Inventory Operations to capture transaction details.
   ●​   Product Request – Gets created when a sample is requested.
   ●​   Product Request Line Item – Gets created to capture details under Product Request
   ●​   Product Item Transaction – Records each transaction on the product
   ●​   automatically
   ●​   Inventory Count Assessment- Gets created to capture Inventory Count.
   ●​   Inventory Count Product Batch Item- Gets created along with Inventory
                                                                                                     34
                           SE LSC Mobile Setup and Configuration Guide

   ●​ Count Assessment to capture Inventory Count details.


Sample Inventory Management Content — Help

MRay Quick Notes to create Sample/Product Disbursement records for Rep
  -​ Make sure Location created is created for Rep
  -​ Check/create Product Item for drug for the Rep’s location
         -​ Add Production Batch record - related list



Signature Rules - Sample Management
Defined in the Life Science Marketable Product record: Mandatory, Optional, Not Required
​




Tab Changes
These are instructions for changing Tab that are part of the Life Science Managed Package




                                                                                            35
                           SE LSC Mobile Setup and Configuration Guide

Since LSC is core + managed package, you think you won't be able to modify a Tab - e.g. new 2nd
Account Tab​
​
If you use the translate feature (English to English), it actually doesn't show up there.

Instead, you need to go to Translation Workbench > Override.
Package = Life Science


Change:
Account -> Account Search (for now until SBC is ready)
Intelligent Content -> Content (since we are here anyways)




Activity Timeline
Videos on how to setup by Rebecca Wang: Link

Activity Timeline Display Text Settings - Example: GDoc




Setup Access to Admin Console
If you need to setup profile that is not System Administrator for LSC Commercial and the “Admin Console” tab​

   1.​ Setup - App Manager - Life Science Commercial — add the profile of the user to the app - e.g.
       Business Admin
   2.​ Setup - Profile - Go to the profile (e.g. Business Admin) - enable tab = Admin Console” to “Default On



Remote Engagement


                                                                                                                36
                            SE LSC Mobile Setup and Configuration Guide

Remote Engagement Setup Instructions: Link




Troubleshooting Synch Issues
2 Areas for checking Synchronization Issues

   ●​ Mobile Admin - Error Log Management
   ●​ Mobile Admin - Synchronization

Synchronization - Transactions will provide synch detail on Entity/Object ​
​




                                                                              37
                            SE LSC Mobile Setup and Configuration Guide


Old Config Instructions
Known Cache Issues
  -​ (this is now fixed) Activity History is not supported. If you have DBSchema record for this - set Active =
     false.


These instructions no longer pertain to the current demo releases and functionality


Configuration

Home Page
Visit Page
Accounts Page
Planner
LSC Apps
Utterances
StoriesGDoc
Tableau
Territories



(Old) Key Resources

Release notes, instructions for setup - LSC Learning Org April 2025
 – Don’t make any changes to this doc it is shared with customers

Guidance for configuration can be found in previous OCE Personal documentation

NYWT LSC App Configuration Details- technical details on Page Layouts, Permissions, Data and other
configuration that were done to build the NYWT Demo

LSC Mobile App & Demo Builds - There are 2 “flavors” of LSC Mobile App. This presentation lists differences
between these, which one to setup and how to setup. it also provides setup tips for the Reflector imaging app.

Key Account Management - Setup of Account Plans and Territory Plans

Sample Inventory Management - Setup of Sample Inventory




Update Page Layouts
Add CommunicationSubscriptionConsent Related List to
   ●​ Account Layout — in Account - HCO Page Layout
                                                                                                             38
                           SE LSC Mobile Setup and Configuration Guide

   ●​ Person Account HCP Layout – in PersonAccount - Person Account HCP Layout




Samples
https://docs.google.com/document/d/1qxqPVURsFWoVY3ha1OFO3AkPFZcK66AicgOgi2b7FxU/edit?tab=t.0




Territory Management
https://docs.google.com/document/d/1BAQhAB1YYKybQ-GU5m_jSrYNZjSC1uwAYSjCwsshVlE/edit?usp=shar
ing



Simulator

The simulator does not have app settings.

In AppSettingsService.swift override isDemoMode property to return true.




LSC Mobile - Supporting Multiple Profiles/Personas

As on Sept 19 - Currently LSC Mobile only supports downloading of one application = the app provided in the
LSC4CE package = Life Sciences Commercial.​
​
To support Multiple Profiles
    -​ Add the Page for the Profile to the Life Sciences Commercial application
    -​ Activate the Page for the Application - Profile - Record Type




Demo Users

Medical Sales Rep = Evan

Medical Sales Manager = Luke




                                                                                                          39
SE LSC Mobile Setup and Configuration Guide




                                              40
