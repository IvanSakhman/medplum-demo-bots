import { BotEvent, createReference, getReferenceString, MedplumClient } from '@medplum/core';
import {
  BundleEntry,
  CarePlan,
  Communication,
  DiagnosticReport,
  Immunization,
  MedicationRequest,
  Observation,
  Patient,
  Practitioner,
  Resource,
  Schedule,
} from '@medplum/fhirtypes';

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const patient = event.input as Patient;
  const patientHistory = await medplum.readHistory('Patient', patient.id as string);
  if ((patientHistory.entry as BundleEntry[]).length > 1) {
    console.log('Patient already has history');
    return;
  }

  console.log('Setting practitioner...');
  const practitioner = await getPractitioner(medplum);
  patient.generalPractitioner = [createReference(practitioner)];
  await medplum.updateResource(patient);

  console.log('Creating A1C...');
  const a1c = await medplum.createResource(createA1CObservation(patient));

  const entries: BundleEntry[] = [];
  entries.push(createEntry(createCompletedCarePlan(patient)));
  entries.push(createEntry(createActiveCarePlan(patient)));
  entries.push(createEntry(createDiagnosticReport(patient, a1c)));
  entries.push(createEntry(createActiveMedicationRequest(patient, practitioner)));
  entries.push(createEntry(createStoppedMedicationRequest(patient, practitioner)));
  entries.push(createEntry(createCompletedImmunization(patient)));
  entries.push(createEntry(createIncompleteImmunization(patient)));
  entries.push(createEntry(createBloodPressureObservation(patient)));
  entries.push(createEntry(createTemperatureObservation(patient)));
  entries.push(createEntry(createHeightObservation(patient)));
  entries.push(createEntry(createWeightObservation(patient)));
  entries.push(createEntry(createRespiratoryRateObservation(patient)));
  entries.push(createEntry(createHeartRateObservation(patient)));
  entries.push(createEntry(createWelcomeMessage(patient, practitioner)));

  console.log('Creating history...');
  const result = await medplum.executeBatch({
    resourceType: 'Bundle',
    type: 'batch',
    entry: entries,
  });
  console.log(result.entry?.map((entry) => entry.response?.status));
}

/**
 * Returns a practitioner resource.
 * Creates the practitioner if one does not already exist.
 * @param medplum The medplum client.
 * @returns The practitioner resource.
 */
async function getPractitioner(medplum: MedplumClient): Promise<Practitioner> {
  const practitioner = await medplum.createResourceIfNoneExist<Practitioner>(
    {
      resourceType: 'Practitioner',
      identifier: [
        {
          system: 'http://hl7.org/fhir/sid/us-npi',
          value: '123456789',
        },
      ],
      name: [
        {
          given: ['Alice'],
          family: 'Smith',
        },
      ],
      photo: [
        {
          contentType: 'image/png',
          url: 'https://docs.medplum.com/img/cdc-femaledoc.png',
        },
      ],
    },
    'identifier=123456789'
  );

  // Make sure the practitioner has a schedule
  await ensureSchedule(medplum, practitioner);

  return practitioner;
}

/**
 * Ensures that the practitioner has a schedule, and that the schedule has slots.
 * @param medplum The medplum client.
 * @param practitioner The practitioner.
 */
async function ensureSchedule(medplum: MedplumClient, practitioner: Practitioner): Promise<void> {
  // Try to get the schedule
  const schedule = await medplum.createResourceIfNoneExist<Schedule>(
    {
      resourceType: 'Schedule',
      id: 'schedule',
      actor: [createReference(practitioner)],
    },
    'actor=Practitioner/' + practitioner.id
  );

  // Ensure there are slots for the next 30 days
  const slotDate = new Date();
  for (let day = 0; day < 30; day++) {
    slotDate.setHours(0, 0, 0, 0);
    await ensureSlots(medplum, schedule, slotDate);
    slotDate.setDate(slotDate.getDate() + 1);
  }
}

/**
 * Ensures that the schedule has slots for the given date.
 * @param medplum The medplum client.
 * @param schedule The practitioner's schedule.
 * @param slotDate The day of slots.
 */
async function ensureSlots(medplum: MedplumClient, schedule: Schedule, slotDate: Date): Promise<void> {
  const existingSlots = await medplum.searchResources(
    'Slot',
    new URLSearchParams([
      ['_summary', 'true'],
      ['schedule', getReferenceString(schedule)],
      ['start', 'gt' + slotDate.toISOString()],
      ['start', 'lt' + new Date(slotDate.getTime() + 24 * 60 * 60 * 1000).toISOString()],
    ])
  );

  if (existingSlots.length > 0) {
    return;
  }

  for (let hour = 0; hour < 24; hour++) {
    slotDate.setHours(hour, 0, 0, 0);
    await medplum.createResource({
      resourceType: 'Slot',
      start: slotDate.toISOString(),
      schedule: createReference(schedule),
    });
  }
}

/**
 * Creates a CarePlan that was completed in the past.
 * @param patient The patient.
 */
function createCompletedCarePlan(patient: Patient): CarePlan {
  return {
    resourceType: 'CarePlan',
    status: 'completed',
    intent: 'order',
    subject: createReference(patient),
    activity: [
      {
        detail: {
          code: {
            text: 'Recommendation to avoid exercise',
          },
          location: {
            display: 'FOOMEDICAL HOSPITAL AND MEDICAL CENTERS',
          },
          status: 'completed',
        },
      },
    ],
    title: 'Respiratory therapy',
    period: {
      start: '2020-01-01T00:00:00.000Z',
      end: '2021-01-01T00:00:00.000Z',
    },
    category: [
      {
        text: 'Respiratory therapy',
      },
    ],
  };
}

/**
 * Creates an active CarePlan that starts today.
 * @param patient The patient.
 */
function createActiveCarePlan(patient: Patient): CarePlan {
  return {
    resourceType: 'CarePlan',
    status: 'active',
    intent: 'order',
    subject: createReference(patient),
    activity: [
      {
        detail: {
          code: {
            text: 'Antenatal education',
          },
          location: {
            display: 'FOOMEDICAL HOSPITAL AND MEDICAL CENTERS',
          },
          status: 'in-progress',
        },
      },
    ],
    title: 'Routine antenatal care',
    period: {
      start: new Date().toISOString(),
    },
    category: [
      {
        text: 'Routine antenatal care',
      },
    ],
  };
}

function createA1CObservation(patient: Patient): Observation {
  return {
    resourceType: 'Observation',
    subject: createReference(patient),
    code: {
      text: 'Hemoglobin A1c',
    },
    valueQuantity: {
      value: 5.4,
      unit: 'mmol/L',
    },
    referenceRange: [
      {
        high: {
          value: 7.0,
        },
      },
    ],
  };
}

/**
 * Creates a DiagnosticReport with an A1C observation.
 * @param patient The patient.
 */
function createDiagnosticReport(patient: Patient, a1c: Observation): DiagnosticReport {
  return {
    resourceType: 'DiagnosticReport',
    status: 'final',
    code: {
      text: 'Hemoglobin A1c',
    },
    subject: createReference(patient),
    result: [createReference(a1c)],
  };
}

function createActiveMedicationRequest(patient: Patient, practitioner: Practitioner): MedicationRequest {
  return {
    resourceType: 'MedicationRequest',
    status: 'active',
    intent: 'order',
    priority: 'routine',
    subject: createReference(patient),
    requester: createReference(practitioner),
    dosageInstruction: [
      {
        text: 'Every six hours (qualifier value)',
        sequence: 1,
        timing: {
          repeat: {
            frequency: 4,
            period: 1,
            periodUnit: 'd',
          },
        },
      },
    ],
    authoredOn: new Date().toISOString(),
    medicationCodeableConcept: {
      text: 'Amoxicillin 500mg',
    },
  };
}

function createStoppedMedicationRequest(patient: Patient, practitioner: Practitioner): MedicationRequest {
  return {
    resourceType: 'MedicationRequest',
    status: 'stopped',
    intent: 'order',
    priority: 'routine',
    subject: createReference(patient),
    requester: createReference(practitioner),
    dosageInstruction: [
      {
        text: 'Every seventy two hours as needed (qualifier value)',
        sequence: 1,
        timing: {
          repeat: {
            frequency: 1,
            period: 3,
            periodUnit: 'd',
          },
        },
      },
    ],
    authoredOn: new Date().toISOString(),
    medicationCodeableConcept: {
      text: 'Biaxin XL (clarithromycin) 500mg',
    },
  };
}

function createCompletedImmunization(patient: Patient): Immunization {
  return {
    resourceType: 'Immunization',
    status: 'completed',
    patient: createReference(patient),
    location: {
      display: 'FOOMEDICAL HOSPITAL AND MEDICAL CENTERS',
    },
    occurrenceDateTime: new Date().toISOString(),
    vaccineCode: {
      text: 'SARS-COV-2 (COVID-19) vaccine, mRNA, spike protein, LNP, preservative free, 100 mcg/0.5mL dose',
    },
  };
}

function createIncompleteImmunization(patient: Patient): Immunization {
  return {
    resourceType: 'Immunization',
    status: 'not-done',
    patient: createReference(patient),
    location: {
      display: 'FOOMEDICAL HOSPITAL AND MEDICAL CENTERS',
    },
    vaccineCode: {
      text: 'Influenza, seasonal, injectable, preservative free',
    },
  };
}

function createBloodPressureObservation(patient: Patient): Observation {
  return {
    resourceType: 'Observation',
    subject: createReference(patient),
    code: {
      coding: [
        {
          code: '85354-9',
          display: 'Blood Pressure',
          system: 'http://loinc.org',
        },
      ],
      text: 'Blood Pressure',
    },
    component: [
      {
        code: {
          coding: [
            {
              code: '8462-4',
              display: 'Diastolic Blood Pressure',
              system: 'http://loinc.org',
            },
          ],
          text: 'Diastolic Blood Pressure',
        },
        valueQuantity: {
          code: 'mm[Hg]',
          system: 'http://unitsofmeasure.org',
          unit: 'mm[Hg]',
          value: 80,
        },
      },
      {
        code: {
          coding: [
            {
              code: '8480-6',
              display: 'Systolic Blood Pressure',
              system: 'http://loinc.org',
            },
          ],
          text: 'Systolic Blood Pressure',
        },
        valueQuantity: {
          code: 'mm[Hg]',
          system: 'http://unitsofmeasure.org',
          unit: 'mm[Hg]',
          value: 120,
        },
      },
    ],
    effectiveDateTime: new Date().toISOString(),
    status: 'final',
  };
}

function createTemperatureObservation(patient: Patient): Observation {
  return {
    resourceType: 'Observation',
    subject: createReference(patient),
    code: {
      coding: [
        {
          code: '8310-5',
          display: 'Body temperature',
          system: 'http://loinc.org',
        },
        {
          code: '8331-1',
          display: 'Oral temperature',
          system: 'http://loinc.org',
        },
      ],
      text: 'Body temperature',
    },
    valueQuantity: {
      code: 'Cel',
      system: 'http://unitsofmeasure.org',
      unit: 'Cel',
      value: 36.6,
    },
    effectiveDateTime: new Date().toISOString(),
    status: 'final',
  };
}

function createHeightObservation(patient: Patient): Observation {
  return {
    resourceType: 'Observation',
    subject: createReference(patient),
    code: {
      coding: [
        {
          code: '8302-2',
          display: 'Body Height',
          system: 'http://loinc.org',
        },
      ],
      text: 'Body Height',
    },
    valueQuantity: {
      code: 'cm',
      system: 'http://unitsofmeasure.org',
      unit: 'cm',
      value: 175,
    },
    effectiveDateTime: new Date().toISOString(),
    status: 'final',
  };
}

function createWeightObservation(patient: Patient): Observation {
  return {
    resourceType: 'Observation',
    subject: createReference(patient),
    code: {
      coding: [
        {
          code: '29463-7',
          display: 'Body Weight',
          system: 'http://loinc.org',
        },
      ],
      text: 'Body Weight',
    },
    valueQuantity: {
      code: 'kg',
      system: 'http://unitsofmeasure.org',
      unit: 'kg',
      value: 70,
    },
    effectiveDateTime: new Date().toISOString(),
    status: 'final',
  };
}

function createRespiratoryRateObservation(patient: Patient): Observation {
  return {
    resourceType: 'Observation',
    subject: createReference(patient),
    code: {
      coding: [
        {
          code: '9279-1',
          display: 'Respiratory rate',
          system: 'http://loinc.org',
        },
      ],
      text: 'Respiratory rate',
    },
    valueQuantity: {
      code: '/min',
      system: 'http://unitsofmeasure.org',
      unit: '/min',
      value: 15,
    },
    effectiveDateTime: new Date().toISOString(),
    status: 'final',
  };
}

function createHeartRateObservation(patient: Patient): Observation {
  return {
    resourceType: 'Observation',
    subject: createReference(patient),
    code: {
      coding: [
        {
          code: '8867-4',
          display: 'Heart rate',
          system: 'http://loinc.org',
        },
      ],
      text: 'Heart rate',
    },
    valueQuantity: {
      code: '/min',
      system: 'http://unitsofmeasure.org',
      unit: '/min',
      value: 80,
    },
    effectiveDateTime: new Date().toISOString(),
    status: 'final',
  };
}

function createWelcomeMessage(patient: Patient, practitioner: Practitioner): Communication {
  return {
    resourceType: 'Communication',
    subject: createReference(patient),
    recipient: [createReference(patient)],
    sender: createReference(practitioner),
    payload: [
      {
        contentString: 'Hello and welcome to our practice',
      },
    ],
  };
}

function createEntry(resource: Resource): BundleEntry {
  return {
    resource,
    request: {
      url: resource.resourceType,
      method: 'POST',
    },
  };
}
