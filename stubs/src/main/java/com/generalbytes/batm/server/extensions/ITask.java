package com.generalbytes.batm.server.extensions;

public interface ITask {
    boolean onCreate();

    boolean onDoStep();

    void onFinish();

    boolean isFinished();

    Object getResult();

    boolean isFailed();

    long getShortestTimeForNexStepInvocation();
}
