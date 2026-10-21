import { Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { DataService } from './data.service';

@Controller()
export class StudentsController {
  constructor(private readonly data: DataService) {}

  @Get('students/:id')
  async getStudent(@Param('id', ParseIntPipe) id: number) {
    const student = await this.data.findStudent(id);
    if (!student) throw new NotFoundException(`Estudiante ${id} no existe`);
    return student;
  }

  // ?expand=courses devuelve los cursos en la misma respuesta (una consulta para todos).
  @Get('students')
  async listStudents(@Query('limit') limit = '100', @Query('expand') expand?: string) {
    const students = await this.data.listStudents(Number(limit));
    if (expand !== 'courses') return students;
    const courses = await this.data.coursesOfMany(students.map((s) => s.id));
    return students.map((s, i) => ({ ...s, courses: courses[i] }));
  }

  // La misma lista, pero como NDJSON (un JSON por linea): el cliente puede procesar el primer estudiante
  // antes de recibir el ultimo. Es el equivalente en REST del streaming de gRPC.
  @Get('stream/students')
  async streamStudents(@Query('limit') limit = '100', @Res() res: ServerResponse) {
    const students = await this.data.listStudents(Number(limit));
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    for (const student of students) {
      if (!res.write(JSON.stringify(student) + '\n')) await new Promise<void>((resolve) => res.once('drain', resolve));
    }
    res.end();
  }

  @Get('students/:id/courses')
  async coursesOf(@Param('id', ParseIntPipe) id: number) {
    return this.data.coursesOf(id);
  }

  // Apoyo del guion: cuantas consultas a la "base de datos" hizo cada escenario.
  @Get('stats')
  stats() {
    return { dbQueries: this.data.queryCount };
  }

  @Post('stats/reset')
  resetStats() {
    this.data.resetQueryCount();
    return { dbQueries: 0 };
  }
}
