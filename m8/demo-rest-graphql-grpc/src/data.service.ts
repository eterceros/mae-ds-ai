import { Injectable } from '@nestjs/common';

export interface Course {
  code: string;
  title: string;
}

export interface Student {
  id: number;
  name: string;
  email: string;
  career: string;
}

const TOTAL_STUDENTS = 2000;
const TOTAL_COURSES = 200;
const COURSES_PER_STUDENT = 5;

const FIRST_NAMES = ['Ana', 'Luis', 'Carla', 'Diego', 'Marta', 'Jorge', 'Lucia', 'Pedro', 'Sofia', 'Marco'];
const LAST_NAMES = ['Rojas', 'Mamani', 'Quispe', 'Vargas', 'Flores', 'Gomez', 'Herrera', 'Salazar', 'Condori', 'Arce'];
const CAREERS = ['Sistemas', 'Informatica', 'Electronica', 'Industrial', 'Civil'];

// Base de datos simulada en memoria. Cada acceso espera DB_LATENCY_MS para que el
// patron N+1 se note como lo haria con una base real; el valor se puede cambiar por entorno.
@Injectable()
export class DataService {
  private readonly latencyMs = Number(process.env.DB_LATENCY_MS ?? 1);
  private readonly students: Student[] = Array.from({ length: TOTAL_STUDENTS }, (_, i) => {
    const id = i + 1;
    const first = FIRST_NAMES[id % FIRST_NAMES.length];
    const last = LAST_NAMES[(id * 3) % LAST_NAMES.length];
    return {
      id,
      name: `${first} ${last} ${id}`,
      email: `${first}.${last}.${id}@estudiantes.umss.edu`.toLowerCase(),
      career: CAREERS[id % CAREERS.length],
    };
  });
  private readonly poolSize = Number(process.env.DB_POOL ?? 10);
  private active = 0;
  private waiters: Array<() => void> = [];
  private queries = 0;

  get queryCount(): number {
    return this.queries;
  }

  resetQueryCount(): void {
    this.queries = 0;
  }

  async findStudent(id: number): Promise<Student | undefined> {
    await this.query();
    return this.students[id - 1];
  }

  async listStudents(limit: number): Promise<Student[]> {
    await this.query();
    return this.students.slice(0, Math.min(Math.max(limit, 0), TOTAL_STUDENTS));
  }

  async coursesOf(studentId: number): Promise<Course[]> {
    await this.query();
    return this.buildCourses(studentId);
  }

  // Una sola consulta para varios estudiantes: es lo que usa el dataloader y los endpoints que expanden.
  async coursesOfMany(studentIds: readonly number[]): Promise<Course[][]> {
    await this.query();
    return studentIds.map((id) => this.buildCourses(id));
  }

  private buildCourses(studentId: number): Course[] {
    return Array.from({ length: COURSES_PER_STUDENT }, (_, k) => {
      const n = (studentId * 7 + k * 13) % TOTAL_COURSES;
      return { code: `CUR-${String(n).padStart(3, '0')}`, title: `Curso numero ${n}` };
    });
  }

  // Como una base real, atiende como maximo DB_POOL consultas a la vez; las demas esperan turno.
  // Sin este limite, 51 consultas en paralelo costarian lo mismo que 1 y el N+1 no se notaria.
  private async query(): Promise<void> {
    this.queries += 1;
    if (this.active >= this.poolSize) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active += 1;
    try {
      if (this.latencyMs > 0) await this.sleep(this.latencyMs);
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  // setTimeout(1) en Windows espera hasta ~15,6 ms (resolucion del temporizador del sistema), asi que una
  // "consulta de 1 ms" costaria 15 ms y dependeria de cuanto trafico haya. Esta espera es precisa y, como
  // solo pregunta por la hora entre turnos del bucle de eventos, no bloquea las peticiones que llegan.
  private sleepers: Array<{ readyAt: number; resolve: () => void }> = [];
  private pumping = false;

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepers.push({ readyAt: performance.now() + ms, resolve });
      if (!this.pumping) {
        this.pumping = true;
        setImmediate(() => this.pump());
      }
    });
  }

  private pump(): void {
    const now = performance.now();
    this.sleepers = this.sleepers.filter((s) => {
      if (s.readyAt > now) return true;
      s.resolve();
      return false;
    });
    if (this.sleepers.length > 0) setImmediate(() => this.pump());
    else this.pumping = false;
  }
}
