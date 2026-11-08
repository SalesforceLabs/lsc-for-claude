# MonetaryCapUtilizationLimits_Admin (264 enablement video)

Source: MonetaryCapUtilizationLimits_Admin.mp4 and the matching Transcript.docx. Narration is speech-to-text; on-screen context is added from video frames where noted.

## On-screen context (from video frames)

Partial: only the frames reviewed so far; timestamps approximate (+/- 10 s).

- ~300 s: the Provider Activity Measure Type criteria JSON was on screen. Not yet transcribed here; see release-264-monetary-cap-utilization-limits.md for the v1/v2 criteria rules.

## Narration

Transcript: MonetaryCapUtilizationLimits_Admin.mp4
Detected language: en (100.0%)

Hello, my name is Crystal Deshpande and I'm a product manager on Agent Force Life Sciences.
Today, I'm going to demonstrate the setup of the monetary cap and utilization limits feature.
These controls allow admins to define event participation limits and HCP compensation limits,
including whether exceeding a limit displays a warning or blocks the user.
Admins can also add the utilization tracker to the HCP account page so users can see each HCP's
limit, current utilization, and also the remaining availability before planning an event.
Let's jump into the setup.
So first, you're going to come to the trigger handlers admin console and search for monetary
and make sure you enable all of the monetary cap related trigger handlers.
And this actually includes all the utilization limits trigger handlers as well.
Once that's done, we need to add the utilization tracker component on the account profile.
Like any other component, it can be dragged and dropped anywhere on the lightning record page.
Once that's added on the managed event record page, we need to add the record update notifier.
This is what displays the actual warning or block message.
We come into the events management admin console field events org settings.
Here, we need to set the concluded event status.
This lets the system know that these are the managed event statuses where the utilization limit
validation or the monetary cap validation needs to be a warning.
The reason for this is because at this point, the event has already taken place.
And if a monetary cap or utilization limit has exceeded, we still need to record attendee or
the expense.
Then within the expense types, we want to go ahead and set the expense types which
need to be included in the cap validation.
For example, here, I've set fee for service and expert fees as included in cap.
Since these are the expense types, I want the system to validate against monetary cap
when I do the allocation.
Now, we need to go ahead and start creating the monetary cap and utilization data.
So we are using the existing activity plans data model.
And so here, we need to create an activity plan for either monetary cap or utilization
limit or both.
And here, we need to indicate the type as event management limit.
And we need to make sure that it's active.
Also, we have a time period entity where you can indicate a time period and then you link
that time period onto the activity plan.
Once the activity plans are created, we need to go ahead and create the provider
activity goals.
Here, what we're doing is we're linking an account with an activity plan.
So for every account that requires a monetary cap validation or a utilization
limit validation or both would require a provider activity goal record.
So here, you can see that Dr.
Aaron Morita has been created for the monetary cap activity plan.
So when Dr.
Aaron Morita is added to an event, he will be validated against the monetary
cap limit.
Now, these records could be high in volume.
So of course, they can be data loaded in bulk.
Now, we're going to switch to workbench.
And here, we need to create provider activity measure type.
And provider activity measure type is where we are going to set the criteria for the
validation for either utilization limits or for monetary cap.
So for example, I'm going to go ahead and go into this record so I can show you how
this monetary cap measure type has been set up.
You would set up the name, the label, the alert type, and the criteria.
So here, the criteria is what the system is going to check against.
So for example, it's going to validate against managed events that are in the following
statuses for the expert participant role type.
And these are the statuses for each bucket.
So for the committed bucket is when the event is in approved or execute status.
And for estimated, that's when the event is in draft or approval.
Status.
Now, a custom script is going to be provided in the documentation as a starting point.
And that custom script can be deployed in either developer console or in workbench.
And then it can be tweaked as per the customer's business rules.
We've set up the provider activity goal measure types.
Now we need to set up the provider activity goal limits for each of the
account goals that we've created.
So here we need to set a either a monetary cap limit or a activity limit,
which is a utilization cap limit for each of the provider activity goals that we set up.
So for each provider activity goal, we link the activity measure type that we just created
for monetary cap or for utilization limit.
And we set the limit for each individual provider activity goal.
Then we need to create the provider activity goal measure.
And here, all we're doing is we're linking the provider activity goal with the provider
activity measure type and setting the type as event management limit.
And then the system does the rest for us.
It calculates the estimated expense, the committed expense, or the actual expense.
And also, if it's a utilization limit measure type,
then it'll calculate the total committed activity value, and so on.
And these calculations are done based on the provider activity goal measure type JSON
that we created earlier.
Now that all of this data has been set up, the last step is to share the provider activity goal
with the territories.
And so this sharing is done based on the customer to territory alignment,
or also known as the provider account territory information records.
Okay, that concludes the setup of the monetary cap and utilization limits feature.
Thank you.
