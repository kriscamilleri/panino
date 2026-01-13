![PrettyNeat Software](https://www.prettyneat.io/assets/prettyneat-logo-lg.png)

# Glucose Pumps Specification
The Glucose Pumps addon for Odoo 18 enables tracking of glucose pump devices across their lifecycle - from available stock through patient assignment to eventual scrapping. Devices can be assigned as either primary or holiday pump (backup for travel), with full assignment history including installation and replacement dates. 

A central dashboard shows device counts by status with quick actions for unassignment and scrapping. Automated alerts flag devices approaching replacement. Chatter integration logs all state changes on both device and patient records.

## A. New Pages
> New icon on dashboard for accessing new module. 

### Glucose Pumps Index Page 
1. In header show cards displaying count of devices which are: 
    - Assigned
    - Unassigned
    - Scrapped
2. Separate sub-menu navigation for:
    - Devices (default view)
    - Patients
3. Display columns:
    - Patient Internal ID 
    - Patient Name
    - Equipment SN
    - Assignment Type (Primary / Holiday Pump)
    - Upcoming Activities
    - Installation Date
4. New buttons
    - For Create Patient
    - For Create Equipment
5. Clicking on a row should take us to linked Lot/SN Equipment page
6. Selecting a row should show the Action button, with 3 options:
    - Unassign Device 
      - Unlink from patient
      - Transfer back to return location
      - Leave note in chatter of patient saying 'Device SN XXXX unassigned.' or 'Holiday Pump SN XXXX unassigned.' (based on assignment type)
      - Leave note in chatter of device stating 'Patient ID 123 unassigned' or 'Patient ID 123 unassigned (holiday pump)' (based on assignment type)
      - Set equipment State to 'available'
    - Replace Device (only available for primary devices)
      - Opens Replace Device Modal
    - Scrap Device 
      - Unlink from patient
      - Move equipment to Scrap location
      - Leave note in patient saying 'Device SN XXXX scrapped'
      - Set equipment State to 'scrapped'

### Create Patient Modal
1. Fields for:
    - Patient Contact information
    - Select Primary Device SN from associated products (see 2 of configuration)
    - Select Holiday Pump SN (optional) from associated products (see 2 of configuration)
    - Holiday Pump Return Date (mandatory when holiday pump is assigned)
    - Installation Date (default today, but editable)
    - Training Location
2. Holiday pump assignment is done by internal users only (not via portal/form/public site)

### Create Pump Modal
1. Keep standard equipment SN page, but add tab 'Linked Patient Information' (pull this from Contacts) 
2. Display installation and replacement date per row
3. Display assignment type (Primary/Holiday Pump) per row

### Replace Device Modal
> Opened when replacing a malfunctioning primary device
1. Display current device information:
    - Current Device SN
    - Patient Name and Internal ID
    - Installation Date
2. Fields for:
    - Replacement Reason (selection: 'Malfunction', 'Damage', 'Other')
    - Replacement Notes (optional)
    - Select Replacement Device SN (only RMA product devices shown)
3. On confirmation:
    - Set replacement date on old device assignment log
    - Unlink old device from patient
    - Set old device State to 'available'
    - Transfer old device to return location
    - Assign new RMA device to patient as primary
    - Set new device State to 'assigned'
    - Create new assignment log with current date as installation date
    - Leave note in patient chatter: 'Primary device SN XXXX replaced with RMA device SN YYYY. Reason: [reason]'
    - Leave note in old device chatter: 'Replaced for Patient ID 123. Reason: [reason]'
    - Leave note in new device chatter: 'Assigned to Patient ID 123 as replacement for SN XXXX'
4. Validation:
    - Only RMA product devices can be selected (per RMA Device Constraints)
    - Replacement device must be in 'available' state

### Patients Index Page
> Located under Glucose Pump App > Patients
1. Separate view for patients within the Pumps module
2. Display columns:
    - Patient Internal ID
    - Patient Name
    - Current Primary Device SN
    - Current Holiday Pump SN (if any)
    - Training Location
    - Allocated consumables this month (if any)
    - Expiration date of primary device 
    - Return date of holiday pump (if any)
3. Clicking on a row should take us to the Patient contact page
4. New button for Create Patient

### Holiday Pump Request Form
> Public website form for patients to request holiday pumps
1. Website form accessible without login for patients to fill in holiday pump requests
2. Fields for:
    - Patient Name
    - Main Pump Serial Number*
    - Mobile Number*
    - Travel Dates (From/To)
    - Destination
    - Additional Notes
3. Form submission creates a record for review by Patient Administrators
4. Email notification sent to helpdesk upon submission
5. All requests must end up in the new Holiday Pump Helpdesk
6. Validate that the serial number exists, and is attached to a patient. If not, do not allow for submission. This should be case insensitive. 

### Consumables Tracking Page
> Located under Glucose Pump App > Consumables
1. Track consumables used per patient per month
2. Display columns:
    - Patient Internal ID
    - Patient Name
    - Month/Year
    - Consumables Allocated
    - Consumables Used
    - Threshold Status
3. UI to specify how many consumables were allocated to which month
4. Thresholds are user configurable per month
5. Visual indicator when usage approaches or exceeds threshold (green if 10 or less used, orange if 11 to 13, red if more than allocated)
6. Do NOT auto-create Sales Orders for excess consumables
![image.png](/api/images/620d08ed-ddb4-468b-b78b-c80c2f27e26c)

# Phase 2 Appendices
## Appendix 1 - Sequence Diagrams
### Repair (Offsite)
![PrettyNeat Software](https://www.prettyneat.io/assets/prettyneat-logo-lg.png)


### Repair (Onsite)
![PrettyNeat Software](https://www.prettyneat.io/assets/prettyneat-logo-lg.png)


### Training Locations Page
> Located under Glucose Pump App > Configuration
1. New model with ID and Text field, for storing potential locations for training (does not use existing location model). 
2. A training location can be associated with one or more patients (from Patient tab in Contact)

### Settings Page
> Located under Glucose Pump App > Configuration
1. Specify which product(s) can be used within the Glucose Pump app. Search will only search for SNs that are linked to these products.
2. Specify which product should be used as RMA replacement device
    - This product can only be used when replacing a malfunctioning primary device
    - When a primary device malfunctions and a replacement is issued, only RMA devices can be assigned
3. Specify which location should be used for returns 
    - Select from list of Internal Locations
    - Default should be WH/Evercare Medical/Insulin Pumps
4. Configure replacement date alert threshold (days before replacement date to trigger alert, default 30 days)
5. Configure consumables thresholds
    - Default monthly threshold (editable per patient per month)
    - Enable/disable threshold warnings
6. Helpdesk email configuration
    - Incoming and outgoing email address: tandemsupport@evercaremedical.eu

## B. Modified Pages

### Create/Edit Equipment Page
1. Keep standard equipment SN page, but add tab below, Linked Patient Information (pull this from Contacts) 
2. Display installation and replacement date per row
3. Display assignment type (Primary / Holiday Pump) per row
4. Add State selection field with values:
    - Available
    - Assigned
    - Scrapped
5. Enable chatter on Equipment records

### Create/Edit Contacts Page
1. On a contacts which have IsPatient = true, display history of linked equipment (including holiday pumps)
2. Display patient Information tab
3. This page can be accessed via going to Patients in Contacts or by clicking on the link to the Patient inside of the Patients Index Page. 
4. Enable chatter on Patient contacts

### Contacts
1. New menu item Patients
2. Only show Contacts that have isPatient = true on Patients screen
3. Replace New button with New Patient on Patients screen to create a New Contact with IsPatient set to true.
4. IsPatient is editable within the Contacts page, but it is not editable when navigating via Create Patient. 
5. Only Individuals not Companies can have Is Patient set to true. 
6. Patient contact must have a new tab Patient Info with the below details:
    - Patient Date of Birth
    - Patient ID Number
    - Patient Phone
    - Patient Locality (ex. Mosta) 
    - Patient Internal ID (auto-generated, year-based format: "YYYY-NNN", e.g. "2024-001", sequence resets annually)
    - Current Primary Device (linked equipment SN)
    - Current Holiday Pump (linked equipment SN, optional)
7. Hide the default phone and mobile fields on the Patient view of a contact (ie when accessing via patients menu)
8. On the card view of the Patients screen, we must display the Patient Internal ID. 

## C. Models and Constraints

### Equipment State
1. Add State selection field to equipment/lot model with the following values:
    - Available - Device is not assigned to any patient
    - Assigned - Device is currently assigned to a patient (primary or holiday pump)
    - Scrapped - Device has been scrapped and is no longer in use
2. State transitions:
    - New equipment defaults to 'available'
    - Assigning to patient (primary or holiday) sets state to 'assigned'
    - Unassigning from patient sets state to 'available'
    - Scrapping sets State to 'scrapped'

### RMA Device Constraints
1. RMA devices are a separate product configured in Settings
2. RMA devices can only be assigned as replacements for malfunctioning primary devices
3. RMA devices cannot be assigned:
    - As the initial primary device for a new patient
    - As a holiday pump
4. When replacing a malfunctioning primary device:
    - Only RMA product devices are available for selection
    - Standard product devices cannot be used as replacements
5. Validation:
    - System must prevent assignment of RMA devices outside of replacement workflow
    - System must prevent assignment of non-RMA devices during replacement workflow

### Training Location
1. Standalone model (does not extend existing Odoo location model)
2. Fields:
    - ID (auto-generated)
    - Name 
    - Active
3. One training location can be linked to many patients


### Assignment Logs
1. Fields for: 
    - Installation date 
    - Replacement date 
    - Equipment Id
    - Contact Id
    - Assignment Type (selection: 'primary' or 'holiday_pump')

### Consumables Allocation
1. Fields for:
    - Patient Id (Contact Id)
    - Month
    - Year
    - Quantity Allocated
    - Quantity Used
    - Threshold (user configurable, defaults to global setting)
2. Constraints:
    - Threshold must be a positive integer
3. Warnings:
    - Display warning 'Charge for additional pumps' if more than 13 consumables are allocated for a given month
4. Do NOT auto-create Sales Orders when usage exceeds allocation

### Holiday Pump Request
1. Fields for:
    - Patient Name
    - Patient Internal ID
    - Contact Email
    - Contact Phone
    - Travel Start Date
    - Travel End Date
    - Destination
    - Reason
    - Additional Notes
    - Status (selection: 'pending', 'approved', 'rejected')
    - Submitted Date
2. Created via public website form submission

### Patient Internal ID Sequence
1. Auto-generated on patient creation
2. Format: "YYYY-NNN" (ex. "2024-0001") where
    - YYYY = current year
    - NNNN = sequential number padded to 3 digits, resets to 001 each year

### Permissions
1. Default users will be 
    - Jonathan
    - Denise
    - Forthcoming employee
2. Group should be called Patient Administrators
3. Patient Administrators should be able to: 
    1. View/Edit Patient App
    2. View/Edit Patient menu in contacts
    3. View/Edit Patient tab in contact card
    4. View Linked Patient Information tab in Equipment

## D. Automated Actions

### Replacement Date Alerts
1. Scheduled action runs daily to check for devices approaching replacement date
2. Alert triggered when device replacement date is within configured threshold (default 30 days)
3. Alert actions:
    - Create activity on the Equipment record assigned to Patient Administrators
4. Alert should include:
    - Equipment SN
    - Patient Internal ID and Name
    - Assignment Type (Primary / Holiday Pump)
    - Replacement Date
    - Days remaining until replacement