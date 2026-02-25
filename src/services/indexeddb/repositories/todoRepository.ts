import { getDatabase } from '../database';
import type { TodoItem, CreateTodoInput, UpdateTodoInput } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

export async function getAllTodos(): Promise<TodoItem[]> {
  const db = await getDatabase();
  return db.getAll('todos');
}

export async function getTodoById(id: string): Promise<TodoItem | undefined> {
  const db = await getDatabase();
  return db.get('todos', id);
}

export async function getTodosByAssignee(assigneeId: string): Promise<TodoItem[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('todos', 'by-assigneeId', assigneeId);
}

export async function createTodo(input: CreateTodoInput): Promise<TodoItem> {
  const db = await getDatabase();
  const now = toISODateString(new Date());

  const todo: TodoItem = {
    ...input,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };

  await db.add('todos', todo);
  return todo;
}

export async function updateTodo(
  id: string,
  input: UpdateTodoInput
): Promise<TodoItem | undefined> {
  const db = await getDatabase();
  const existing = await db.get('todos', id);

  if (!existing) {
    return undefined;
  }

  const updated: TodoItem = {
    ...existing,
    ...input,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('todos', updated);
  return updated;
}

export async function deleteTodo(id: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.get('todos', id);

  if (!existing) {
    return false;
  }

  await db.delete('todos', id);
  return true;
}
