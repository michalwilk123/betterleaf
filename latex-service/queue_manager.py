import asyncio
import random
import shutil
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field

from compiler import CompileResult, compile_latex

MAX_CONCURRENT = 2
MAX_QUEUE_SIZE = 20


@dataclass
class Job:
    work_dir: str
    entrypoint: str
    timeout: int
    compiler: str = "pdflatex"
    halt_on_error: bool = False
    future: asyncio.Future[CompileResult] = field(default_factory=lambda: asyncio.get_event_loop().create_future())


class QueueManager:
    def __init__(self) -> None:
        self._client_jobs: dict[str, list[Job]] = {}
        self._pending_count = 0
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        self._executor = ProcessPoolExecutor(max_workers=MAX_CONCURRENT)
        self._has_work = asyncio.Event()
        self._shutdown = False
        self._dispatch_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        self._dispatch_task = asyncio.create_task(self._dispatch_loop())

    async def stop(self) -> None:
        self._shutdown = True
        self._has_work.set()  # unblock the loop
        if self._dispatch_task:
            self._dispatch_task.cancel()
            try:
                await self._dispatch_task
            except asyncio.CancelledError:
                pass
        self._executor.shutdown(wait=False)

    def submit(self, client_id: str, job: Job) -> None:
        if self._pending_count >= MAX_QUEUE_SIZE:
            raise QueueFullError()
        if client_id not in self._client_jobs:
            self._client_jobs[client_id] = []
        self._client_jobs[client_id].append(job)
        self._pending_count += 1
        self._has_work.set()

    async def _dispatch_loop(self) -> None:
        loop = asyncio.get_event_loop()
        while not self._shutdown:
            await self._has_work.wait()
            self._has_work.clear()

            while self._pending_count > 0 and not self._shutdown:
                await self._semaphore.acquire()

                # Pick a random client with pending jobs
                clients_with_jobs = [
                    cid for cid, jobs in self._client_jobs.items() if jobs
                ]
                if not clients_with_jobs:
                    self._semaphore.release()
                    break

                client_id = random.choice(clients_with_jobs)
                job = self._client_jobs[client_id].pop(0)
                if not self._client_jobs[client_id]:
                    del self._client_jobs[client_id]
                self._pending_count -= 1

                asyncio.create_task(self._run_job(loop, job))

    async def _run_job(self, loop: asyncio.AbstractEventLoop, job: Job) -> None:
        try:
            result = await loop.run_in_executor(
                self._executor,
                compile_latex,
                job.work_dir,
                job.entrypoint,
                job.timeout,
                job.compiler,
                job.halt_on_error,
            )
            job.future.set_result(result)
        except Exception as e:
            if not job.future.done():
                job.future.set_exception(e)
        finally:
            self._semaphore.release()
            self._has_work.set()  # re-check for more work
            # Cleanup work dir
            shutil.rmtree(job.work_dir, ignore_errors=True)


class QueueFullError(Exception):
    pass
