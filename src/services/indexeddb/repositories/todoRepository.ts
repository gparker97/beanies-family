import { createRepository } from '../createRepository';
import { getDatabase } from '../database';
import type { TodoItem, CreateTodoInput, UpdateTodoInput } from '@/types/models';

const repo = createRepository<'todos', TodoItem, CreateTodoInput, UpdateTodoInput>('todos');

export const getAllTodos = repo.getAll;
export const getTodoById = repo.getById;
export const createTodo = repo.create;
export const updateTodo = repo.update;
export const deleteTodo = repo.remove;

export async function getTodosByAssignee(assigneeId: string): Promise<TodoItem[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('todos', 'by-assigneeId', assigneeId);
}
