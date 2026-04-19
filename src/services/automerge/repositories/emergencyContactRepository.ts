import { createAutomergeRepository } from '../automergeRepository';
import type { EmergencyContact } from '@/types/models';

const repo = createAutomergeRepository<'emergencyContacts', EmergencyContact>('emergencyContacts');

export const getAllEmergencyContacts = repo.getAll;
export const getEmergencyContactById = repo.getById;
export const createEmergencyContact = repo.create;
export const updateEmergencyContact = repo.update;
export const deleteEmergencyContact = repo.remove;
