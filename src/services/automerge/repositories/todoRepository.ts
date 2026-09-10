import { createAutomergeRepository } from '../automergeRepository';
import { normalizeAssignees } from '@/utils/assignees';
import type { TodoItem, CreateTodoInput, UpdateTodoInput } from '@/types/models';

const repo = createAutomergeRepository<'todos', TodoItem, CreateTodoInput, UpdateTodoInput>(
  'todos'
);

export const getAllTodos = repo.getAll;
export const getTodoById = repo.getById;
export const createTodo = repo.create;
export const updateTodo = repo.update;
export const deleteTodo = repo.remove;
/**
 * Re-create a to-do under its ORIGINAL id, for undoing a delete.
 *
 * `create` mints a new UUID, which would make "undo" produce a different record
 * that has lost its completion history. Mirrors
 * `familyMemberRepository.createFamilyMemberWithId`, the existing precedent for
 * "this entity must keep its id across a rebuild".
 */
export const createTodoWithId = repo.createWithId;

export async function getTodosByAssignee(assigneeId: string): Promise<TodoItem[]> {
  const todos = await getAllTodos();
  return todos.filter((t) => normalizeAssignees(t).includes(assigneeId));
}
